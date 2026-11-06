import type { LatLng } from "./live-map";

export type FetchJson = (url: string) => Promise<unknown>;

const OSRM_ROUTE = "https://router.project-osrm.org/route/v1/driving";
const USER_AGENT = "betterbus (bus map for Belize City)";
const WAYPOINTS_PER_CALL = 100;
const SNAP_RADIUS_M = 40;
const BEARING_RANGE_DEG = 45;
const DETOUR_FACTOR = 1.6;
const DETOUR_SLACK_M = 60;
const SKIP_AHEAD = [2, 3, 4, 6];
const EXCURSION_BASE_M = 15;
const EXCURSION_MIN_M = 8;
const EXCURSION_TURN_DEG = 150;
const STUB_M = 10;
const EXCURSION_MAX_M = 300;
const TURNAROUND_NEAR_M = 120;
const TURNAROUND_MIN_M = 40;
const TURNAROUND_MAX_M = 800;
const TURNAROUND_RATIO = 0.6;
const PAUSE_BETWEEN_CALLS_MS = 300;

type Leg = { distance: number; coordinates: LatLng[] };

type OsrmResponse = {
	code: string;
	routes?: {
		legs: { distance: number; steps: { geometry: { coordinates: [number, number][] } }[] }[];
	}[];
};

const DEG = Math.PI / 180;

function metersBetween(a: LatLng, b: LatLng): number {
	const dx = (b.lng - a.lng) * Math.cos(a.lat * DEG) * 111_320;
	const dy = (b.lat - a.lat) * 111_320;

	return Math.hypot(dx, dy);
}

function bearingBetween(a: LatLng, b: LatLng): number {
	const dx = (b.lng - a.lng) * Math.cos(a.lat * DEG);
	const dy = b.lat - a.lat;

	return Math.round((((Math.atan2(dx, dy) / DEG) % 360) + 360) % 360);
}

// The direction of travel through each point, taken from its neighbours.
function bearings(points: LatLng[]): number[] {
	return points.map((_, i) =>
		bearingBetween(points[Math.max(i - 1, 0)], points[Math.min(i + 1, points.length - 1)]),
	);
}

function buildUrl(points: LatLng[], headings: number[], indices: number[]): string {
	const coords = indices.map((i) => `${points[i].lng.toFixed(6)},${points[i].lat.toFixed(6)}`);
	const radiuses = indices.map(() => String(SNAP_RADIUS_M));
	const bearingParams = indices.map((i) => `${headings[i]},${BEARING_RANGE_DEG}`);
	const query = new URLSearchParams({
		overview: "false",
		geometries: "geojson",
		steps: "true",
		continue_straight: "true",
		radiuses: radiuses.join(";"),
		bearings: bearingParams.join(";"),
	});

	return `${OSRM_ROUTE}/${coords.join(";")}?${query}`;
}

function parseLegs(payload: unknown): Leg[] | null {
	const response = payload as OsrmResponse;
	const route = response.routes?.[0];

	if (response.code !== "Ok" || !route) return null;

	return route.legs.map((leg) => {
		const coordinates: LatLng[] = [];

		for (const step of leg.steps) {
			for (const [lng, lat] of step.geometry.coordinates) {
				const last = coordinates.at(-1);
				if (!last || last.lng !== lng || last.lat !== lat) {
					coordinates.push({ lng, lat });
				}
			}
		}

		return { distance: leg.distance, coordinates };
	});
}

function originalLength(points: LatLng[], from: number, to: number): number {
	let total = 0;

	for (let i = from; i < to; i++) {
		total += metersBetween(points[i], points[i + 1]);
	}

	return total;
}

// A routed leg that is much longer than the trace it replaces went the long
// way round, usually a U-turn forced by a point snapping to the wrong road.
function followsTrace(points: LatLng[], from: number, to: number, routed: number): boolean {
	return routed <= originalLength(points, from, to) * DETOUR_FACTOR + DETOUR_SLACK_M;
}

async function defaultFetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

	if (!response.ok) {
		throw new Error(`OSRM answered ${response.status}`);
	}

	return response.json();
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls a coarse route trace onto the road network.
 *
 * Every trace point becomes a waypoint, with a bearing so it snaps to the
 * carriageway going the bus's way. Legs that still detour are rerouted past
 * the offending point, and a leg that cannot be fixed keeps the trace as it
 * was, so a gap in the road data never bends the whole line.
 */
// Places where the trace itself folds back: a roundabout, a turnaround, a
// loop round a block. Between two such points the bus ends up close to where
// it was after a long way round.
function turnarounds(points: LatLng[]): LatLng[] {
	const found: LatLng[] = [];

	for (let i = 0; i < points.length; i++) {
		let path = 0;

		for (let j = i + 1; j < points.length; j++) {
			path += metersBetween(points[j - 1], points[j]);
			if (path > TURNAROUND_MAX_M) break;
			if (path < TURNAROUND_MIN_M) continue;

			if (metersBetween(points[i], points[j]) <= path * TURNAROUND_RATIO) {
				found.push(points[i]);
				break;
			}
		}
	}

	return found;
}

function turnBetween(a: number, b: number): number {
	return Math.abs(((b - a + 540) % 360) - 180);
}

// A GPS point a few metres past a junction makes the router overshoot the
// corner and double back. Dropping the point leaves the corner itself.
function removeStubs(points: LatLng[]): LatLng[] {
	const output: LatLng[] = [];

	for (let k = 0; k < points.length; k++) {
		const previous = output.at(-1);

		if (previous && k + 1 < points.length) {
			const next = points[k + 1];
			const stub = Math.min(metersBetween(previous, points[k]), metersBetween(points[k], next));
			const turn = turnBetween(
				bearingBetween(previous, points[k]),
				bearingBetween(points[k], next),
			);

			if (stub <= STUB_M && turn >= EXCURSION_TURN_DEG) continue;
		}

		output.push(points[k]);
	}

	return output;
}

/**
 * Cuts loops the router invented. When a turn is missing from the road data,
 * OSRM drives past the junction, U-turns and comes back, so the routed line
 * leaves a spot and returns to it a few hundred metres later. The trace shows
 * no such fold there, so the loop goes and the line jumps straight across.
 */
export function removeExcursions(matched: LatLng[], trace: LatLng[]): LatLng[] {
	const routed = removeStubs(matched);
	const folds = turnarounds(trace);
	const cumulative = [0];

	for (let i = 1; i < routed.length; i++) {
		cumulative.push(cumulative[i - 1] + metersBetween(routed[i - 1], routed[i]));
	}

	const traceFoldsNear = (from: number, to: number): boolean => {
		let tip = routed[from];
		let tipDistance = 0;

		for (let k = from + 1; k < to; k++) {
			const distance = metersBetween(routed[from], routed[k]);
			if (distance > tipDistance) {
				tip = routed[k];
				tipDistance = distance;
			}
		}

		return folds.some((fold) => metersBetween(fold, tip) <= TURNAROUND_NEAR_M);
	};

	// Somewhere inside a hairpin the line runs back against the way it left.
	// An ordinary corner never does.
	const turnsBack = (from: number, to: number): boolean => {
		const out = bearingBetween(routed[from], routed[from + 1]);

		for (let k = from + 1; k < to; k++) {
			if (turnBetween(out, bearingBetween(routed[k], routed[k + 1])) >= EXCURSION_TURN_DEG) {
				return true;
			}
		}

		return false;
	};

	const output: LatLng[] = [];
	let a = 0;

	while (a < routed.length) {
		output.push(routed[a]);
		let next = a + 1;

		for (let b = a + 2; b < routed.length; b++) {
			const path = cumulative[b] - cumulative[a];
			if (path > EXCURSION_MAX_M) break;
			if (path < EXCURSION_MIN_M) continue;

			if (
				metersBetween(routed[a], routed[b]) <= EXCURSION_BASE_M &&
				turnsBack(a, b) &&
				!traceFoldsNear(a, b)
			) {
				next = b;
			}
		}

		a = next;
	}

	return output;
}

export async function matchRouteToRoads(
	points: LatLng[],
	fetchJson: FetchJson = defaultFetchJson,
	pauseMs = PAUSE_BETWEEN_CALLS_MS,
): Promise<LatLng[]> {
	if (points.length < 2) return points;

	const headings = bearings(points);
	const legs = new Map<number, Leg>();

	const route = async (indices: number[]): Promise<Leg[] | null> => {
		const parsed = parseLegs(await fetchJson(buildUrl(points, headings, indices)));
		if (pauseMs > 0) await pause(pauseMs);

		return parsed;
	};

	for (let start = 0; start < points.length - 1; start += WAYPOINTS_PER_CALL - 1) {
		const end = Math.min(start + WAYPOINTS_PER_CALL, points.length);
		const indices = Array.from({ length: end - start }, (_, i) => start + i);
		const routed = await route(indices);

		if (!routed) {
			throw new Error("OSRM could not route the trace");
		}

		routed.forEach((leg, i) => legs.set(start + i, leg));
	}

	const output: LatLng[] = [];
	const append = (coordinates: LatLng[]) => {
		for (const point of coordinates) {
			const last = output.at(-1);
			if (!last || last.lng !== point.lng || last.lat !== point.lat) {
				output.push(point);
			}
		}
	};

	const last = points.length - 1;
	let i = 0;

	while (i < last) {
		const leg = legs.get(i);

		if (leg && followsTrace(points, i, i + 1, leg.distance)) {
			append(leg.coordinates);
			i += 1;
			continue;
		}

		let repaired = false;

		for (const skip of SKIP_AHEAD) {
			const to = Math.min(i + skip, last);
			const routed = await route([i, to]);

			if (routed?.[0] && followsTrace(points, i, to, routed[0].distance)) {
				append(routed[0].coordinates);
				i = to;
				repaired = true;
				break;
			}

			if (to === last) break;
		}

		if (!repaired) {
			const to = Math.min(i + 2, last);
			append(points.slice(i, to + 1));
			i = to;
		}
	}

	return removeExcursions(output, points);
}
