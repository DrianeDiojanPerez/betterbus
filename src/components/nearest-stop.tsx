import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useEffectEvent } from "react";

import { useMap } from "@/components/ui/map";
import { haversineMeters, type LngLat } from "@/lib/geo";
import type { BusRoute, BusStop } from "@/server/live-map";

// Room around the rider and the stop for the card that opens beside them,
// as a share of the map, with a cap on big screens.
const PADDING_SHARE = 0.22;
const MAX_PADDING = { x: 170, y: 200 };
const MAX_ZOOM = 16;
const FIT_MS = 800;

export function nearestStop(routes: BusRoute[], position: LngLat): BusStop | null {
	let nearest: BusStop | null = null;
	let nearestMeters = Infinity;

	for (const route of routes) {
		for (const stop of route.stops) {
			const meters = haversineMeters(position, [stop.lng, stop.lat]);
			if (meters < nearestMeters) {
				nearest = stop;
				nearestMeters = meters;
			}
		}
	}

	return nearest;
}

function padding(map: MapLibreMap) {
	const { clientWidth, clientHeight } = map.getContainer();
	const x = Math.min(MAX_PADDING.x, clientWidth * PADDING_SHARE);
	const y = Math.min(MAX_PADDING.y, clientHeight * PADDING_SHARE);

	return { top: y, bottom: y, left: x, right: x };
}

function inView(map: MapLibreMap, points: LngLat[]): boolean {
	const { clientWidth, clientHeight } = map.getContainer();
	const room = padding(map);

	return points.every((point) => {
		const { x, y } = map.project(point);
		return (
			x >= room.left &&
			x <= clientWidth - room.right &&
			y >= room.top &&
			y <= clientHeight - room.bottom
		);
	});
}

/**
 * On each request, frames the rider and their nearest stop, then picks that
 * stop so its card opens once the camera has settled.
 */
export function NearestStop({
	request,
	position,
	routes,
	onChoose,
	onPick,
}: {
	request: number;
	position: LngLat | null;
	routes: BusRoute[];
	/** As soon as the stop is known, before the camera moves. */
	onChoose: (stopId: number) => void;
	onPick: (stopId: number) => void;
}) {
	const { map } = useMap();
	const pick = useEffectEvent(onPick);
	const choose = useEffectEvent(onChoose);
	// Read when a request comes in, so the card's own walking-time button,
	// which also sets the position, never moves the card to another stop.
	const find = useEffectEvent(() => {
		const stop = position ? nearestStop(routes, position) : null;
		return position && stop ? { from: position, stop } : null;
	});

	useEffect(() => {
		if (!map || request === 0) return;
		const found = find();
		if (!found) return;
		const { from, stop } = found;
		choose(stop.id);

		let fallback = 0;
		const open = () => {
			clearTimeout(fallback);
			map.off("moveend", open);
			pick(stop.id);
		};
		const frame = () => {
			map.off("moveend", frame);
			// Already in view with room for the card: moving would only redraw the map.
			if (inView(map, [from, [stop.lng, stop.lat]])) {
				open();
				return;
			}
			map.fitBounds(
				[
					[Math.min(from[0], stop.lng), Math.min(from[1], stop.lat)],
					[Math.max(from[0], stop.lng), Math.max(from[1], stop.lat)],
				],
				{ padding: padding(map), maxZoom: MAX_ZOOM, duration: FIT_MS },
			);
			map.once("moveend", open);
			// A camera already in place may not report a move at all.
			fallback = window.setTimeout(open, FIT_MS + 200);
		};

		// The locate button flies to the rider first; frame them once it lands.
		if (map.isMoving()) map.once("moveend", frame);
		else frame();

		return () => {
			clearTimeout(fallback);
			map.off("moveend", frame);
			map.off("moveend", open);
		};
	}, [map, request]);

	return null;
}
