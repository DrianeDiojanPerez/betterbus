import { createServerFn } from "@tanstack/react-start";

import { matchRouteToRoads } from "./road-match";

export type LatLng = { lat: number; lng: number };

export type BusStop = {
	id: number;
	name: string;
	lat: number;
	lng: number;
	stop_order: number;
};

export type BusRoute = {
	id: number;
	name: string;
	code: string;
	direction: string;
	operator_id: number;
	operator_name: string;
	color: string;
	geometry: LatLng[];
	stops: BusStop[];
};

export type LiveBus = {
	bus_id: number;
	trip_id: number;
	route_id: number | null;
	bus_name: string;
	plate_number: string;
	route_name: string;
	route_code: string;
	operator_id: number;
	route_color: string;
	lat: number;
	lng: number;
	speed: number;
	heading: number;
	status: string;
	current_loop_number: number;
	current_stop_order: number;
	next_stop_order: number;
	driver_name: string | null;
	server_time: string;
};

export type LiveMap = {
	status: string;
	server_now: string;
	routes: BusRoute[];
	buses: LiveBus[];
};

const FEED_URL = "https://bus.techtingz.bz/live-map/data";
const ROAD_MATCH_RETRY_MS = 10 * 60 * 1000;

type RoadGeometryEntry = { matched: LatLng[] | null; expiresAt: number | null };

// Matched once per route per process. A failed match keeps the feed's own
// line for a while instead of asking the router again on every poll.
const roadGeometry = new Map<string, RoadGeometryEntry>();

function roadGeometryKey(route: BusRoute): string {
	const first = route.geometry.at(0);
	const last = route.geometry.at(-1);

	return [route.id, route.geometry.length, first?.lng, first?.lat, last?.lng, last?.lat].join(":");
}

function startRoadMatch(key: string, route: BusRoute): RoadGeometryEntry {
	const entry: RoadGeometryEntry = { matched: null, expiresAt: null };

	matchRouteToRoads(route.geometry).then(
		(geometry) => {
			entry.matched = geometry;
		},
		(error: unknown) => {
			console.warn(`Road match failed for route ${route.id}; using feed geometry.`, error);
			entry.expiresAt = Date.now() + ROAD_MATCH_RETRY_MS;
		},
	);
	roadGeometry.set(key, entry);

	return entry;
}

// The matched line once the router has answered, the feed's own line until
// then. Matching can take many seconds, and the next poll picks up the result.
function withRoadGeometry(route: BusRoute): BusRoute {
	const key = roadGeometryKey(route);
	const now = Date.now();
	let entry = roadGeometry.get(key);

	if (!entry || (entry.expiresAt !== null && entry.expiresAt <= now)) {
		entry = startRoadMatch(key, route);
	}

	return entry.matched ? { ...route, geometry: entry.matched } : route;
}

async function fetchLiveMap(): Promise<LiveMap> {
	const response = await fetch(`${FEED_URL}?_ts=${Date.now()}`, {
		headers: {
			Accept: "application/json",
			"X-Requested-With": "XMLHttpRequest",
			"Cache-Control": "no-cache",
		},
	});

	if (!response.ok) {
		throw new Error(`Live map feed answered ${response.status}`);
	}

	const feed = (await response.json()) as LiveMap;

	return { ...feed, routes: feed.routes.map(withRoadGeometry) };
}

let inFlight: Promise<LiveMap> | null = null;

// The feed sends no CORS headers, so the browser cannot call it directly.
// Riders polling at the same moment share one upstream request.
export const getLiveMap = createServerFn({ method: "GET" }).handler((): Promise<LiveMap> => {
	inFlight ??= fetchLiveMap().finally(() => {
		inFlight = null;
	});

	return inFlight;
});
