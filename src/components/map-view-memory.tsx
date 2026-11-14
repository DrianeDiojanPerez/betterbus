import { useEffect } from "react";

import { useMap } from "@/components/ui/map";
import type { LngLat } from "@/lib/geo";

const STORAGE_KEY = "betterbus-map-view";
// Following a bus ends a camera move on every frame, so wait for a pause.
const SAVE_DELAY_MS = 500;

export type SavedView = {
	center: LngLat;
	zoom: number;
	bearing: number;
	/** The corners the screen showed, south-west then north-east. */
	bounds: [LngLat, LngLat];
};

const isLngLat = (value: unknown): value is LngLat =>
	Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

export function savedView(): SavedView | null {
	if (typeof window === "undefined") return null;

	try {
		const view = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as SavedView | null;
		const valid =
			view !== null &&
			isLngLat(view.center) &&
			Number.isFinite(view.zoom) &&
			Number.isFinite(view.bearing) &&
			Array.isArray(view.bounds) &&
			view.bounds.every(isLngLat);

		return valid ? view : null;
	} catch {
		return null;
	}
}

export function shows(view: SavedView, [lng, lat]: LngLat): boolean {
	const [[west, south], [east, north]] = view.bounds;

	return lng >= west && lng <= east && lat >= south && lat <= north;
}

/**
 * Saves the camera when it comes to rest, so a refresh opens the map where
 * the rider left it.
 */
export function MapViewMemory() {
	const { map } = useMap();

	useEffect(() => {
		if (!map) return;

		let timer: ReturnType<typeof setTimeout> | undefined;

		const save = () => {
			const { lng, lat } = map.getCenter();
			const bounds = map.getBounds();
			const view: SavedView = {
				center: [lng, lat],
				zoom: map.getZoom(),
				bearing: map.getBearing(),
				bounds: [
					[bounds.getWest(), bounds.getSouth()],
					[bounds.getEast(), bounds.getNorth()],
				],
			};

			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
			} catch {
				// Private mode or full storage: the map just opens at the default view.
			}
		};

		const schedule = () => {
			clearTimeout(timer);
			timer = setTimeout(save, SAVE_DELAY_MS);
		};

		map.on("moveend", schedule);
		window.addEventListener("pagehide", save);

		return () => {
			clearTimeout(timer);
			map.off("moveend", schedule);
			window.removeEventListener("pagehide", save);
		};
	}, [map]);

	return null;
}
