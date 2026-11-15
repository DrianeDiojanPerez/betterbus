import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useId } from "react";

import { useMap } from "@/components/ui/map";
import { haversineMeters, type LngLat } from "@/lib/geo";
import { useResolvedTheme } from "@/lib/settings";

// Dot radius in pixels at a few zoom levels, small when zoomed out and bigger
// up close, like a walking route on a directions map.
const DOT_RADIUS_STOPS: [zoom: number, radius: number][] = [
	[12, 2],
	[15, 3.5],
	[18, 6],
];
// Centre to centre, in dot radii: a gap a little wider than a dot.
const DOT_SPACING_RADII = 4.5;
const RING_WIDTH_PX = 1.25;
// The background colour around each dot, so the same-coloured route line under
// it can't swallow them.
const RING_COLOR = { dark: "#1f2430", light: "#ffffff" };
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const TILE_SIZE = 512;
// MapLibre fades paint changes in from the default, black, so the real colour
// is applied straight away instead.
const INSTANT = { duration: 0, delay: 0 };
// Matches the stop card's open and close, so the dots come and go with it.
const FADE = { duration: 300, delay: 0 };

function lerp(a: LngLat, b: LngLat, t: number): LngLat {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function dotRadius(zoom: number): number {
	const [first] = DOT_RADIUS_STOPS;
	const last = DOT_RADIUS_STOPS[DOT_RADIUS_STOPS.length - 1];
	if (zoom <= first[0]) return first[1];
	if (zoom >= last[0]) return last[1];

	const upper = DOT_RADIUS_STOPS.findIndex(([stopZoom]) => stopZoom >= zoom);
	const [z0, r0] = DOT_RADIUS_STOPS[upper - 1];
	const [z1, r1] = DOT_RADIUS_STOPS[upper];

	return r0 + ((r1 - r0) * (zoom - z0)) / (z1 - z0);
}

// Dots every `spacing` metres along the path, starting `phase` metres in.
function dotsAlong(path: LngLat[], spacing: number, phase: number): LngLat[] {
	const dots: LngLat[] = [];
	let next = phase;
	let travelled = 0;

	for (let i = 1; i < path.length; i++) {
		const length = haversineMeters(path[i - 1], path[i]);
		const end = travelled + length;

		if (length > 0) {
			for (; next <= end; next += spacing) {
				dots.push(lerp(path[i - 1], path[i], (next - travelled) / length));
			}
		}
		travelled = end;
	}

	return dots;
}

// The gap is set on the ground for each whole zoom level, so between levels the
// dots spread apart or close up with the map and the count changes in steps.
// Counted back from the stop, the dots stay put while the bus eats into the road.
function renderDots(map: MapLibreMap, source: string, path: LngLat[], level: number) {
	const dots = map.getSource<GeoJSONSource>(source);
	if (!dots || path.length < 2) return;

	const latitude = (path[0][1] * Math.PI) / 180;
	const metersPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(latitude)) / (TILE_SIZE * 2 ** level);
	const spacing = dotRadius(level) * DOT_SPACING_RADII * metersPerPixel;

	dots.setData({
		type: "FeatureCollection",
		features: dotsAlong(path.toReversed(), spacing, spacing).map((point) => ({
			type: "Feature",
			properties: {},
			geometry: { type: "Point", coordinates: point },
		})),
	});
}

/**
 * The road from the coming bus to the chosen stop as evenly spaced dots in the
 * route's colour, standing still like a walking route on a directions map.
 * Zooming in spreads them out and shows more; zooming out shows fewer.
 */
export function RoadAhead({
	path,
	color,
	visible,
}: {
	path: LngLat[];
	color: string;
	visible: boolean;
}) {
	const { map, isLoaded } = useMap();
	const ring = RING_COLOR[useResolvedTheme()];
	// Its own ids, so a closing card's dots and an opening card's can both be on the map.
	const id = useId();
	const SOURCE = `road-ahead-${id}`;
	const LAYER = `road-ahead-dots-${id}`;

	useEffect(() => {
		if (!map || !isLoaded) return;

		map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
		map.addLayer({
			id: LAYER,
			type: "circle",
			source: SOURCE,
			paint: {
				"circle-radius": ["interpolate", ["linear"], ["zoom"], ...DOT_RADIUS_STOPS.flat()],
				"circle-stroke-width": RING_WIDTH_PX,
				"circle-pitch-alignment": "map",
				"circle-color-transition": INSTANT,
				"circle-stroke-color-transition": INSTANT,
				"circle-opacity": 0,
				"circle-stroke-opacity": 0,
				"circle-opacity-transition": FADE,
				"circle-stroke-opacity-transition": FADE,
			},
		});

		return () => {
			if (map.getLayer(LAYER)) map.removeLayer(LAYER);
			if (map.getSource(SOURCE)) map.removeSource(SOURCE);
		};
	}, [map, isLoaded, SOURCE, LAYER]);

	// Runs after the effect above in the same commit, so the layer exists
	// whenever the map is loaded.
	useEffect(() => {
		if (!map || !isLoaded || !map.getLayer(LAYER)) return;

		map.setPaintProperty(LAYER, "circle-color", color);
		map.setPaintProperty(LAYER, "circle-stroke-color", ring);
		map.setPaintProperty(LAYER, "circle-opacity", visible ? 1 : 0);
		map.setPaintProperty(LAYER, "circle-stroke-opacity", visible ? 1 : 0);
	}, [map, isLoaded, LAYER, color, ring, visible]);

	// Redrawn as the road shortens with the bus and when the zoom crosses into
	// another whole level.
	useEffect(() => {
		if (!map || !isLoaded) return;

		let level = Math.round(map.getZoom());
		renderDots(map, SOURCE, path, level);
		const onZoom = () => {
			const next = Math.round(map.getZoom());
			if (next === level) return;
			level = next;
			renderDots(map, SOURCE, path, level);
		};
		map.on("zoom", onZoom);

		return () => {
			map.off("zoom", onZoom);
		};
	}, [map, isLoaded, SOURCE, path]);

	return null;
}
