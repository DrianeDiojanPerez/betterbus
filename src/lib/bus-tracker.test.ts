import { describe, expect, it } from "vitest";

import type { LiveBus, LiveMap } from "@/server/live-map";

import { BusTracker, DWELL_S, MAX_EXTRAPOLATION_S } from "./bus-tracker";
import { haversineMeters, type LngLat } from "./geo";

// A straight road running east for about 2 km with a stop every 500 m.
const road = Array.from({ length: 21 }, (_, i) => ({ lat: 17.5, lng: -88.19 + i * 0.00094 }));
const stops = [0, 5, 10, 15, 20].map((i, order) => ({
	id: order + 1,
	name: `Stop ${order + 1}`,
	lat: road[i].lat,
	lng: road[i].lng,
	stop_order: order + 1,
}));
const STOP_2: LngLat = [road[5].lng, road[5].lat];

function bus(overrides: Partial<LiveBus> = {}): LiveBus {
	return {
		bus_id: 1,
		trip_id: 1,
		route_id: 1,
		bus_name: "Bus 1",
		plate_number: "B1",
		route_name: "Road",
		route_code: "RD",
		operator_id: 1,
		route_color: "#000",
		lat: road[2].lat,
		lng: road[2].lng,
		speed: 36,
		heading: 90,
		status: "active",
		current_loop_number: 1,
		current_stop_order: 1,
		next_stop_order: 2,
		driver_name: null,
		server_time: "2026-11-03T15:00:00.000Z",
		...overrides,
	};
}

function feed(buses: LiveBus[], serverNow = "2026-11-03T15:00:00.000Z"): LiveMap {
	return {
		status: "ok",
		server_now: serverNow,
		routes: [
			{
				id: 1,
				name: "Road",
				code: "RD",
				direction: "one-way",
				operator_id: 1,
				operator_name: "Op",
				color: "#000",
				geometry: road,
				stops,
			},
		],
		buses,
	};
}

const T0 = Date.parse("2026-11-03T15:00:00.000Z");

function iso(offsetMs: number): string {
	return new Date(T0 + offsetMs).toISOString();
}

// Runs the tracker at 20 frames a second and returns every frame's position.
function run(tracker: BusTracker, from: number, to: number) {
	const frames = [];
	for (let t = from; t <= to; t += 50) {
		frames.push(tracker.tick(t)[0]);
	}
	return frames;
}

function settle(tracker: BusTracker, from: number, to: number) {
	const frames = run(tracker, from, to);
	return frames[frames.length - 1];
}

function eastOf(origin: LngLat, position: LngLat): number {
	return Math.sign(position[0] - origin[0]) * haversineMeters(origin, position);
}

describe("BusTracker", () => {
	it("moves a bus forward at its reported speed between fixes", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus()]), T0);

		const start = tracker.tick(T0)[0];
		const later = settle(tracker, T0, T0 + 10_000);
		const travelled = haversineMeters(start.position, later.position);

		// 36 km/h is 10 m/s, and the simulation runs two seconds ahead of the fix.
		expect(travelled).toBeGreaterThan(105);
		expect(travelled).toBeLessThan(125);
		expect(later.heading).toBeCloseTo(90, 0);
	});

	it("keeps a stopped bus where it is", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus({ speed: 0 })]), T0);

		const start = tracker.tick(T0)[0];
		const later = settle(tracker, T0, T0 + 10_000);

		expect(haversineMeters(start.position, later.position)).toBeLessThan(1);
		expect(later.dwelling).toBe(true);
	});

	it("lists the stops ahead of a bus in the order it will reach them", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus()]), T0);

		const tracked = tracker.tick(T0)[0];
		const ahead = tracker.stopsAheadOf(1, T0, 3);

		expect(ahead.map((arrival) => arrival.stop.name)).toEqual(["Stop 2", "Stop 3", "Stop 4"]);
		expect(ahead[0].stop.id).toBe(tracked.nextStop?.id);
		expect(ahead[1].stopsBetween).toBe(1);
		expect(ahead[0].etaSeconds).toBeLessThan(ahead[1].etaSeconds ?? 0);
		expect(ahead[1].etaSeconds).toBeLessThan(ahead[2].etaSeconds ?? 0);
	});

	it("estimates the time to the next stop from distance and speed", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus()]), T0);

		const tracked = tracker.tick(T0)[0];

		// From the third road point to stop 2 is three segments, roughly 300 m.
		expect(tracked.nextStop?.name).toBe("Stop 2");
		expect(tracked.metersToNextStop).toBeGreaterThan(280);
		expect(tracked.metersToNextStop).toBeLessThan(320);
		expect(tracked.etaSeconds).toBeCloseTo((tracked.metersToNextStop ?? 0) / 10, 3);
	});

	it("stops extrapolating and flags a bus whose fix is too old", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus()]), T0);

		const atLimit = settle(tracker, T0, T0 + MAX_EXTRAPOLATION_S * 1000);
		const beyond = settle(
			tracker,
			T0 + MAX_EXTRAPOLATION_S * 1000,
			T0 + (MAX_EXTRAPOLATION_S + 30) * 1000,
		);

		expect(atLimit.stale).toBe(false);
		expect(beyond.stale).toBe(true);
		expect(haversineMeters(atLimit.position, beyond.position)).toBeLessThan(15);
	});

	it("never moves backwards when a fix lands behind the marker", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus()]), T0);
		run(tracker, T0, T0 + 5_000);
		const origin: LngLat = [road[2].lng, road[2].lat];

		// Five seconds in the marker is about 50 m along. The bus reports only 20 m.
		const behind = { lng: road[2].lng + 0.00094 * 0.2, lat: road[2].lat };
		tracker.update(feed([bus({ ...behind, server_time: iso(5_000) })], iso(5_000)), T0 + 5_000);

		const frames = run(tracker, T0 + 5_050, T0 + 20_000);
		const offsets = frames.map((frame) => eastOf(origin, frame.position));

		for (let i = 1; i < offsets.length; i++) {
			expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1] - 0.01);
		}

		// By then the simulated bus, two seconds ahead, has covered 20 m + 17 s at 10 m/s.
		expect(offsets.at(-1)).toBeGreaterThan(180);
		expect(offsets.at(-1)).toBeLessThan(200);
	});

	it("keeps rolling, slowed, when a fix lands well behind the marker", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus({ lng: road[2].lng + 0.00094, speed: 36 })]), T0);
		run(tracker, T0, T0 + 5_000);
		const before = tracker.tick(T0 + 5_000)[0];

		// The marker is about 150 m along; the bus reports 100 m behind that, still at 10 m/s.
		const behind = { lng: road[2].lng + 0.00094 * 0.5, lat: road[2].lat };
		tracker.update(feed([bus({ ...behind, server_time: iso(5_000) })], iso(5_000)), T0 + 5_000);

		const later = settle(tracker, T0 + 5_050, T0 + 8_000);
		const moved = eastOf(before.position, later.position);

		expect(moved).toBeGreaterThan(5);
		expect(moved).toBeLessThan(25);
		expect(later.speedMps).toBeGreaterThanOrEqual(2.4);
	});

	it("catches up gently, never racing, when a fix lands ahead of the marker", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus()]), T0);
		run(tracker, T0, T0 + 5_000);
		const before = tracker.tick(T0 + 5_000)[0];

		// The fix lands about 130 m ahead of where the marker got to.
		const ahead = { lng: road[2].lng + 0.00094 * 2, lat: road[2].lat };
		tracker.update(feed([bus({ ...ahead, server_time: iso(5_000) })], iso(5_000)), T0 + 5_000);

		const frames = run(tracker, T0 + 5_050, T0 + 20_000);
		const gapBefore = 130;
		const simulatedEnd = ahead.lng + 0.00094 * 1.7; // 15 s plus the 2 s lead at 10 m/s
		const gapAfter = haversineMeters(frames.at(-1)?.position ?? [0, 0], [simulatedEnd, ahead.lat]);

		for (const frame of frames) {
			expect(frame.speedMps).toBeLessThanOrEqual(10 * 1.35);
		}
		expect(gapAfter).toBeLessThan(gapBefore);
		expect(eastOf(before.position, frames.at(-1)?.position ?? [0, 0])).toBeGreaterThan(150);
	});

	it("freezes the marker when the bus reports zero speed at the stop it has reached", () => {
		const tracker = new BusTracker();
		tracker.update(feed([bus({ lng: road[4].lng, speed: 18 })]), T0);
		run(tracker, T0, T0 + 20_000);
		const before = tracker.tick(T0 + 20_000)[0];

		// 20 s at 5 m/s puts the marker at stop 2. The bus reports standing at stop 2.
		tracker.update(
			feed([bus({ lng: STOP_2[0], speed: 0, server_time: iso(20_000) })], iso(20_000)),
			T0 + 20_000,
		);
		const frames = run(tracker, T0 + 20_050, T0 + 30_000);

		for (const frame of frames) {
			expect(eastOf(before.position, frame.position)).toBeGreaterThanOrEqual(-0.01);
			expect(haversineMeters(frame.position, STOP_2)).toBeLessThan(3);
		}
		expect(frames.at(-1)?.dwelling).toBe(true);
	});

	it("predicts a dwell at the next stop when the bus approaches it slowly", () => {
		const tracker = new BusTracker();
		// 100 m before stop 2 at 18 km/h, which is 5 m/s.
		const approaching = { lng: STOP_2[0] - 0.00094, lat: road[5].lat };
		tracker.update(feed([bus({ ...approaching, speed: 18 })]), T0);

		const arriving = settle(tracker, T0, T0 + 22_000);
		const departing = settle(tracker, T0 + 22_000, T0 + (20 + DWELL_S + 10) * 1000);

		expect(haversineMeters(arriving.position, STOP_2)).toBeLessThan(5);
		expect(arriving.dwelling).toBe(true);
		expect(eastOf(STOP_2, departing.position)).toBeGreaterThan(30);
	});

	it("rolls through the next stop when the bus approaches it fast", () => {
		const tracker = new BusTracker();
		// 100 m before stop 2 at 36 km/h.
		const approaching = { lng: STOP_2[0] - 0.00094, lat: road[5].lat };
		tracker.update(feed([bus({ ...approaching, speed: 36 })]), T0);

		const later = settle(tracker, T0, T0 + 20_000);

		// 20 s at 10 m/s is 200 m, so 100 m past the stop with no pause.
		expect(eastOf(STOP_2, later.position)).toBeGreaterThan(85);
		expect(later.dwelling).toBe(false);
	});

	it("lists arrivals at a chosen stop, soonest first, counting dwells on the way", () => {
		const tracker = new BusTracker();
		tracker.update(
			feed([bus(), bus({ bus_id: 2, bus_name: "Bus 2", lng: road[12].lng, speed: 18 })]),
			T0,
		);
		tracker.tick(T0);

		// Stop 4 sits at road point 15. Bus 2 is 300 m away at 5 m/s with no stop between;
		// bus 1 is 1.3 km away at 10 m/s with stops 2 and 3 in between.
		const arrivals = tracker.arrivalsAt(4, T0);

		expect(arrivals.map((a) => a.bus.bus_name)).toEqual(["Bus 2", "Bus 1"]);
		expect(arrivals[0].stopsBetween).toBe(0);
		expect(arrivals[0].etaSeconds).toBeCloseTo(arrivals[0].metersAhead / 5, 3);
		expect(arrivals[1].stopsBetween).toBe(2);
		expect(arrivals[1].etaSeconds).toBeCloseTo(arrivals[1].metersAhead / 10 + 2 * DWELL_S, 3);
		expect(
			haversineMeters(arrivals[0].path.at(-1) ?? [0, 0], [road[15].lng, road[15].lat]),
		).toBeLessThan(2);

		// Stop 1 is behind both buses on a one-way road, so nobody is arriving.
		expect(tracker.arrivalsAt(1, T0)).toHaveLength(0);
	});
});
