import { describe, expect, it } from "vitest";

import {
	arcAhead,
	arcDelta,
	buildPolyline,
	haversineMeters,
	pointAtArc,
	projectOntoPolyline,
	sliceArc,
	type LngLat,
} from "./geo";

// A square about 1 km on a side near Belize City.
const square: LngLat[] = [
	[-88.19, 17.5],
	[-88.1806, 17.5],
	[-88.1806, 17.509],
	[-88.19, 17.509],
];

describe("buildPolyline", () => {
	it("adds the closing side of a loop to its length", () => {
		const open = buildPolyline(square, false);
		const closed = buildPolyline(square, true);

		expect(closed.length - open.length).toBeCloseTo(haversineMeters(square[3], square[0]), 3);
	});
});

describe("projectOntoPolyline and pointAtArc", () => {
	it("round-trip a point sitting on the line", () => {
		const line = buildPolyline(square, true);
		const onLine: LngLat = [-88.185, 17.5];
		const projection = projectOntoPolyline(line, onLine);

		expect(projection.distance).toBeLessThan(1);
		expect(projection.heading).toBeCloseTo(90, 0);

		const back = pointAtArc(line, projection.arc);
		expect(haversineMeters(back.position, onLine)).toBeLessThan(1);
	});

	it("snap a point beside the line onto it and report the gap", () => {
		const line = buildPolyline(square, true);
		const beside: LngLat = [-88.185, 17.5003];
		const projection = projectOntoPolyline(line, beside);

		expect(projection.distance).toBeGreaterThan(30);
		expect(projection.distance).toBeLessThan(35);
		expect(projection.snapped[1]).toBeCloseTo(17.5, 6);
	});

	it("wraps around the loop when the arc passes the end", () => {
		const line = buildPolyline(square, true);
		const start = pointAtArc(line, 0);
		const wrapped = pointAtArc(line, line.length);

		expect(haversineMeters(start.position, wrapped.position)).toBeLessThan(1);
	});
});

describe("arc helpers", () => {
	const line = buildPolyline(square, true);

	it("take the short way round a loop", () => {
		expect(arcDelta(line, 10, line.length - 10)).toBeCloseTo(-20, 6);
		expect(arcDelta(line, line.length - 10, 10)).toBeCloseTo(20, 6);
	});

	it("measure the road ahead, never behind", () => {
		expect(arcAhead(line, 100, 150)).toBeCloseTo(50, 6);
		expect(arcAhead(line, 150, 100)).toBeCloseTo(line.length - 50, 6);

		const open = buildPolyline(square, false);
		expect(arcAhead(open, 150, 100)).toBe(Infinity);
	});
});

describe("sliceArc", () => {
	const line = buildPolyline(square, true);

	it("returns the vertices between two arcs with exact ends", () => {
		const side = line.cumulative[1];
		const slice = sliceArc(line, side / 2, side + line.cumulative[1] / 2);

		expect(slice).toHaveLength(3);
		expect(haversineMeters(slice[0], pointAtArc(line, side / 2).position)).toBeLessThan(0.01);
		expect(slice[1]).toEqual(square[1]);
		expect(haversineMeters(slice[2], square[1])).toBeCloseTo(side / 2, -1);
	});

	it("wraps around the end of a loop", () => {
		const slice = sliceArc(line, line.length - 10, 10);

		expect(slice).toHaveLength(3);
		expect(slice[1]).toEqual(square[0]);
		expect(haversineMeters(slice[0], slice[1])).toBeCloseTo(10, 0);
		expect(haversineMeters(slice[1], slice[2])).toBeCloseTo(10, 0);
	});

	it("collapses to a single point when there is nothing ahead", () => {
		expect(sliceArc(line, 50, 50)).toHaveLength(1);
	});
});
