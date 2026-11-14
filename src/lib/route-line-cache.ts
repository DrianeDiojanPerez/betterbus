import type { BusRoute, LatLng, LiveMap } from "@/server/live-map";

const STORAGE_KEY = "betterbus-route-lines";

type SavedLines = Record<string, LatLng[]>;

function read(): SavedLines {
	try {
		return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as SavedLines) ?? {};
	} catch {
		return {};
	}
}

function write(lines: SavedLines) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
	} catch {}
}

/**
 * Remembers each route's street line in the browser, so a reload draws it
 * right away while the server is still matching a route the feed changed.
 */
export function withSavedRouteLines(live: LiveMap): LiveMap {
	if (typeof window === "undefined") return live;

	const saved = read();
	const kept: SavedLines = {};
	let changed = false;

	const routes = live.routes.map((route): BusRoute => {
		const key = route.geometry_key;
		if (!key) return route;

		if (route.road_matched) {
			kept[key] = route.geometry;
			changed ||= JSON.stringify(saved[key]) !== JSON.stringify(route.geometry);
			return route;
		}

		const line = saved[key];
		if (!line) return route;

		kept[key] = line;
		return { ...route, geometry: line, road_matched: true };
	});

	if (changed || Object.keys(kept).length !== Object.keys(saved).length) write(kept);

	return { ...live, routes };
}
