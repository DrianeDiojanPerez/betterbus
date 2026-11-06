import { describe, expect, it } from "vitest";

import type { LatLng } from "./live-map";
import { matchRouteToRoads, removeExcursions } from "./road-match";

// A straight trace running east, one point every 100 m or so.
function trace(count: number): LatLng[] {
	return Array.from({ length: count }, (_, i) => ({ lat: 17.5, lng: -88.19 + i * 0.00094 }));
}

function nearestIndex(points: LatLng[], lng: number, lat: number): number {
	let best = 0;
	let bestDistance = Infinity;

	points.forEach((point, i) => {
		const distance = Math.hypot(point.lng - lng, point.lat - lat);
		if (distance < bestDistance) {
			best = i;
			bestDistance = distance;
		}
	});

	return best;
}

function straightMeters(a: LatLng, b: LatLng): number {
	return Math.hypot((b.lng - a.lng) * 106_000, (b.lat - a.lat) * 111_320);
}

// Marks a road point so a test can tell routed geometry from the trace.
function roadPoint(a: LatLng, b: LatLng): LatLng {
	return { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 + 0.0001 };
}

type FakeOptions = {
	// Legs starting here detour unless the request skips the next point.
	detourAt?: number[];
	// Legs starting here detour no matter what.
	brokenAt?: number[];
};

function fakeOsrm(points: LatLng[], options: FakeOptions = {}) {
	const urls: string[] = [];

	const fetchJson = (url: string) => {
		urls.push(url);
		const path = new URL(url).pathname.split("/").pop() ?? "";
		const indices = path.split(";").map((pair) => {
			const [lng, lat] = pair.split(",").map(Number);
			return nearestIndex(points, lng, lat);
		});

		const legs = indices.slice(0, -1).map((from, k) => {
			const to = indices[k + 1];
			const straight = straightMeters(points[from], points[to]);
			const detours =
				options.brokenAt?.includes(from) || (options.detourAt?.includes(from) && to === from + 1);

			return {
				distance: detours ? straight + 2000 : straight * 1.1,
				steps: [
					{
						geometry: {
							coordinates: [
								[points[from].lng, points[from].lat],
								[roadPoint(points[from], points[to]).lng, roadPoint(points[from], points[to]).lat],
								[points[to].lng, points[to].lat],
							] as [number, number][],
						},
					},
				],
			};
		});

		return Promise.resolve({ code: "Ok", routes: [{ legs }] });
	};

	return { fetchJson, urls };
}

function hasRoadPoint(output: LatLng[], points: LatLng[], from: number, to: number): boolean {
	const expected = roadPoint(points[from], points[to]);

	return output.some(
		(point) =>
			Math.abs(point.lng - expected.lng) < 1e-9 && Math.abs(point.lat - expected.lat) < 1e-9,
	);
}

describe("matchRouteToRoads", () => {
	it("uses the road geometry when every leg follows the trace", async () => {
		const points = trace(10);
		const { fetchJson, urls } = fakeOsrm(points);

		const output = await matchRouteToRoads(points, fetchJson, 0);

		expect(urls).toHaveLength(1);
		expect(output).toHaveLength(19);
		expect(hasRoadPoint(output, points, 3, 4)).toBe(true);
	});

	it("splits long traces into overlapping calls and joins them without a seam", async () => {
		const points = trace(150);
		const { fetchJson, urls } = fakeOsrm(points);

		const output = await matchRouteToRoads(points, fetchJson, 0);

		expect(urls).toHaveLength(2);
		expect(urls[1]).toContain(`${points[99].lng.toFixed(6)},${points[99].lat.toFixed(6)}`);
		expect(output.filter((p) => p.lng === points[99].lng && p.lat === points[99].lat)).toHaveLength(
			1,
		);
		expect(hasRoadPoint(output, points, 98, 99)).toBe(true);
		expect(hasRoadPoint(output, points, 99, 100)).toBe(true);
	});

	it("routes past a point that forces a detour", async () => {
		const points = trace(10);
		const { fetchJson, urls } = fakeOsrm(points, { detourAt: [4] });

		const output = await matchRouteToRoads(points, fetchJson, 0);

		expect(urls).toHaveLength(2);
		expect(hasRoadPoint(output, points, 4, 6)).toBe(true);
		expect(hasRoadPoint(output, points, 4, 5)).toBe(false);
		expect(output.some((p) => p.lng === points[5].lng && p.lat === points[5].lat)).toBe(false);
	});

	it("keeps the trace where the road data cannot be followed", async () => {
		const points = trace(10);
		const { fetchJson } = fakeOsrm(points, { brokenAt: [4] });

		const output = await matchRouteToRoads(points, fetchJson, 0);

		expect(hasRoadPoint(output, points, 4, 5)).toBe(false);
		expect(hasRoadPoint(output, points, 4, 6)).toBe(false);
		for (const i of [4, 5, 6]) {
			expect(output.some((p) => p.lng === points[i].lng && p.lat === points[i].lat)).toBe(true);
		}
		expect(hasRoadPoint(output, points, 6, 7)).toBe(true);
	});

	it("passes a bearing and snap radius for every waypoint", async () => {
		const points = trace(5);
		const { fetchJson, urls } = fakeOsrm(points);

		await matchRouteToRoads(points, fetchJson, 0);

		const query = new URL(urls[0]).searchParams;
		expect(query.get("radiuses")?.split(";")).toHaveLength(5);
		expect(query.get("bearings")?.split(";")).toHaveLength(5);
		expect(query.get("bearings")?.startsWith("90,")).toBe(true);
	});
});

// Points offset east and north of an origin by metres.
function at(east: number, north: number): LatLng {
	return { lng: -88.19 + east / 106_000, lat: 17.5 + north / 111_320 };
}

describe("removeExcursions", () => {
	it("drops a loop the router made where the driven runs straight", () => {
		const driven = [at(0, 0), at(300, 0), at(600, 0)];
		const routed = [at(0, 0), at(300, 0), at(300, 80), at(306, 80), at(306, 0), at(600, 0)];

		expect(removeExcursions(routed, driven)).toEqual([
			at(0, 0),
			at(300, 0),
			at(306, 0),
			at(600, 0),
		]);
	});

	it("keeps a loop the driven makes too", () => {
		const driven = [at(0, 0), at(300, 0), at(300, 80), at(306, 0), at(600, 0)];
		const routed = [at(0, 0), at(300, 0), at(300, 80), at(306, 80), at(306, 0), at(600, 0)];

		expect(removeExcursions(routed, driven)).toEqual(routed);
	});

	it("drops a short hairpin past a junction", () => {
		const driven = [at(0, 0), at(300, 0), at(600, 0)];
		const routed = [at(0, 0), at(300, 0), at(302, 15), at(304, 0), at(600, 0)];

		expect(removeExcursions(routed, driven)).toEqual([
			at(0, 0),
			at(300, 0),
			at(304, 0),
			at(600, 0),
		]);
	});

	it("drops a stub where a point sat just past a corner", () => {
		const driven = [at(0, 0), at(300, 0), at(300, 300)];
		const routed = [at(0, 0), at(300, 0), at(305, 0), at(300, 2), at(300, 300)];

		expect(removeExcursions(routed, driven)).toEqual([
			at(0, 0),
			at(300, 0),
			at(300, 2),
			at(300, 300),
		]);
	});

	it("cuts a loop back to where the road carries on", () => {
		const driven = [at(0, 0), at(0, 300), at(300, 300)];
		const routed = [
			at(0, 0),
			at(0, 300),
			at(0, 400),
			at(-8, 400),
			at(-8, 298),
			at(0, 300),
			at(300, 300),
		];

		expect(removeExcursions(routed, driven)).toEqual([
			at(0, 0),
			at(0, 300),
			at(0, 300),
			at(300, 300),
		]);
	});

	it("keeps an ordinary corner", () => {
		const driven = [at(0, 0), at(300, 0), at(300, 300)];
		const routed = [at(0, 0), at(290, 0), at(300, 0), at(300, 10), at(300, 300)];

		expect(removeExcursions(routed, driven)).toEqual(routed);
	});

	it("leaves a road driven out and back far apart alone", () => {
		const driven = [at(0, 0), at(800, 0), at(800, 10), at(0, 10)];
		const routed = [at(0, 0), at(800, 0), at(800, 10), at(0, 10)];

		expect(removeExcursions(routed, driven)).toEqual(routed);
	});
});
