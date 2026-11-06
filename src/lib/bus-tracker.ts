import type { BusRoute, BusStop, LiveBus, LiveMap } from "@/server/live-map";

import {
	arcAhead,
	arcDelta,
	buildPolyline,
	moveAlongBearing,
	normalizeArc,
	pointAtArc,
	projectOntoPolyline,
	sliceArc,
	type LngLat,
	type Polyline,
} from "./geo";

export const MAX_EXTRAPOLATION_S = 90;
export const SNAP_MAX_M = 65;
export const DWELL_S = 20;
const MIN_MOVING_MPS = 0.8;
const DEFAULT_SPEED_MPS = 5.5;
const SPEED_SMOOTHING = 0.3;
// Below this on approach, a bus is braking for the stop and will dwell there.
const DWELL_APPROACH_MPS = 6;
const AT_STOP_M = 40;
const STOPS_TO_SIMULATE = 3;
// The simulation runs this far ahead of the fix. Being early is cheaper
// than being late: a marker ahead eases off, a marker behind has to rush.
const LEAD_S = 2;
// Catching up: close the gap over this long, at little more than the pace.
const CATCH_UP_S = 4;
const CATCH_UP_FACTOR = 0.3;
const MIN_CATCH_UP_MPS = 2.5;
// Running ahead: scale speed down across this much road, but while the
// simulated bus is moving the marker never drops below this share of its
// pace. A marker that halts looks like a bus that stopped.
const SLOW_WINDOW_M = 60;
const MIN_SLOW_FACTOR = 0.25;
const ACCEL_TAU_MS = 600;
// A fix this far from the marker is not a prediction error but a different
// reading, so the marker jumps to it.
const SNAP_M = 250;

export type TrackedBus = {
	bus: LiveBus;
	position: LngLat;
	heading: number;
	speedMps: number;
	onRoute: boolean;
	stale: boolean;
	dwelling: boolean;
	ageSeconds: number;
	nextStop: BusStop | null;
	metersToNextStop: number | null;
	etaSeconds: number | null;
};

export type StopArrival = {
	bus: LiveBus;
	stop: BusStop;
	metersAhead: number;
	stopsBetween: number;
	etaSeconds: number | null;
	stale: boolean;
	path: LngLat[];
};

type RouteIndex = {
	route: BusRoute;
	line: Polyline;
	stops: { stop: BusStop; arc: number }[];
};

type Track = {
	bus: LiveBus;
	route: RouteIndex | null;
	anchorArc: number;
	anchorPosition: LngLat;
	anchorTimeMs: number;
	speedMps: number;
	averageSpeedMps: number;
	displayedArc: number;
	displayedSpeedMps: number;
	displayedPosition: LngLat;
	heading: number;
	lastTickMs: number | null;
};

type Prediction = { arc: number; speedMps: number; dwelling: boolean };

function indexRoute(route: BusRoute): RouteIndex {
	const points = route.geometry.map((point) => [point.lng, point.lat] as LngLat);
	const line = buildPolyline(points, route.direction === "loop");
	const stops = route.stops.map((stop) => ({
		stop,
		arc: projectOntoPolyline(line, [stop.lng, stop.lat]).arc,
	}));

	return { route, line, stops };
}

// A bus waiting at a stop still has to cover the road ahead, so its recent
// moving pace stands in for a zero reading.
function effectiveSpeedOf(track: Track): number {
	return track.speedMps >= MIN_MOVING_MPS ? track.speedMps : track.averageSpeedMps;
}

function smoothSpeed(previous: number, reported: number): number {
	if (reported < MIN_MOVING_MPS) return previous;

	return previous * (1 - SPEED_SMOOTHING) + reported * SPEED_SMOOTHING;
}

function stopsAhead(
	route: RouteIndex,
	arc: number,
): { stop: BusStop; arc: number; meters: number }[] {
	return route.stops
		.map((entry) => ({ ...entry, meters: arcAhead(route.line, arc, entry.arc) }))
		.filter((entry) => Number.isFinite(entry.meters))
		.toSorted((a, b) => a.meters - b.meters);
}

/**
 * Keeps every bus moving between feed updates, and never backwards.
 *
 * Each update anchors a bus at the position and time the server reported.
 * From there the bus is simulated forward: at its reported speed, pausing at
 * stops it is braking for, rolling through stops it approaches fast. The
 * drawn marker chases that simulation with its own speed. Behind it, the
 * marker hurries; ahead of it, the marker slows and lets the simulation
 * catch up, so a late fix never drags the bus back down the road.
 */
export class BusTracker {
	private routes = new Map<number, RouteIndex>();
	private tracks = new Map<number, Track>();
	private clockOffsetMs = 0;

	update(feed: LiveMap, receivedAtMs: number): void {
		const serverNow = Date.parse(feed.server_now);
		if (!Number.isNaN(serverNow)) {
			this.clockOffsetMs = receivedAtMs - serverNow;
		}

		this.routes = new Map(feed.routes.map((route) => [route.id, indexRoute(route)]));

		const seen = new Set<number>();

		for (const bus of feed.buses) {
			seen.add(bus.bus_id);
			this.anchor(bus);
		}

		for (const id of this.tracks.keys()) {
			if (!seen.has(id)) this.tracks.delete(id);
		}
	}

	private anchor(bus: LiveBus): void {
		const position: LngLat = [bus.lng, bus.lat];
		const route = this.resolveRoute(bus, position);
		const projection = route ? projectOntoPolyline(route.line, position) : null;
		const onRoute = projection !== null && projection.distance <= SNAP_MAX_M;
		const reportedTime = Date.parse(bus.server_time);
		const anchorTimeMs = Number.isNaN(reportedTime)
			? Date.now()
			: reportedTime + this.clockOffsetMs;
		const speedMps = bus.speed / 3.6;
		const existing = this.tracks.get(bus.bus_id);
		const anchorArc = onRoute ? projection.arc : 0;
		const keepDisplayed = existing?.route !== null && existing?.route !== undefined && onRoute;

		this.tracks.set(bus.bus_id, {
			bus,
			route: onRoute ? route : null,
			anchorArc,
			anchorPosition: onRoute ? projection.snapped : position,
			anchorTimeMs,
			speedMps,
			averageSpeedMps: smoothSpeed(existing?.averageSpeedMps ?? DEFAULT_SPEED_MPS, speedMps),
			displayedArc: keepDisplayed ? existing.displayedArc : anchorArc,
			displayedSpeedMps: existing?.displayedSpeedMps ?? speedMps,
			displayedPosition: existing?.displayedPosition ?? (onRoute ? projection.snapped : position),
			heading: onRoute ? projection.heading : bus.heading,
			lastTickMs: existing?.lastTickMs ?? null,
		});
	}

	private resolveRoute(bus: LiveBus, position: LngLat): RouteIndex | null {
		const byId = bus.route_id === null ? undefined : this.routes.get(bus.route_id);
		if (byId) return byId;

		let nearest: RouteIndex | null = null;
		let nearestDistance = Infinity;

		for (const candidate of this.routes.values()) {
			const { distance } = projectOntoPolyline(candidate.line, position);
			if (distance < nearestDistance) {
				nearest = candidate;
				nearestDistance = distance;
			}
		}

		return nearestDistance <= SNAP_MAX_M ? nearest : null;
	}

	tick(nowMs: number): TrackedBus[] {
		const result: TrackedBus[] = [];

		for (const track of this.tracks.values()) {
			result.push(this.advance(track, nowMs));
		}

		return result;
	}

	private advance(track: Track, nowMs: number): TrackedBus {
		const ageSeconds = Math.max(0, (nowMs - track.anchorTimeMs) / 1000);
		const stale = ageSeconds > MAX_EXTRAPOLATION_S;
		const travel = stale ? MAX_EXTRAPOLATION_S : ageSeconds + LEAD_S;
		const dtSeconds = track.lastTickMs === null ? 0 : (nowMs - track.lastTickMs) / 1000;
		track.lastTickMs = nowMs;

		if (track.route) {
			return this.advanceOnRoute(track, travel, dtSeconds, stale, ageSeconds);
		}

		const moving = track.speedMps >= MIN_MOVING_MPS;
		const predicted = moveAlongBearing(
			track.anchorPosition,
			track.heading,
			moving ? track.speedMps * travel : 0,
		);
		const ease = dtSeconds === 0 ? 1 : 1 - Math.exp((-dtSeconds * 1000) / ACCEL_TAU_MS);
		track.displayedPosition = [
			track.displayedPosition[0] + (predicted[0] - track.displayedPosition[0]) * ease,
			track.displayedPosition[1] + (predicted[1] - track.displayedPosition[1]) * ease,
		];

		return {
			bus: track.bus,
			position: track.displayedPosition,
			heading: track.heading,
			speedMps: track.speedMps,
			onRoute: false,
			stale,
			dwelling: false,
			ageSeconds,
			nextStop: null,
			metersToNextStop: null,
			etaSeconds: null,
		};
	}

	// Where the bus should be after travelling from its anchor for this long.
	private predict(track: Track, route: RouteIndex, travelSeconds: number): Prediction {
		if (track.speedMps < MIN_MOVING_MPS) {
			return { arc: track.anchorArc, speedMps: 0, dwelling: true };
		}

		let arc = track.anchorArc;
		let remaining = travelSeconds;
		let speed = track.speedMps;
		const ahead = stopsAhead(route, arc).filter((entry) => entry.meters > AT_STOP_M);

		for (const stop of ahead.slice(0, STOPS_TO_SIMULATE)) {
			const toStop = arcAhead(route.line, arc, stop.arc);
			const secondsToStop = toStop / speed;

			if (remaining <= secondsToStop) break;

			arc = stop.arc;
			remaining -= secondsToStop;

			if (speed < DWELL_APPROACH_MPS) {
				if (remaining <= DWELL_S) {
					return { arc, speedMps: 0, dwelling: true };
				}

				remaining -= DWELL_S;
				speed = track.averageSpeedMps;
			}
		}

		return {
			arc: normalizeArc(route.line, arc + speed * remaining),
			speedMps: speed,
			dwelling: false,
		};
	}

	private advanceOnRoute(
		track: Track,
		travelSeconds: number,
		dtSeconds: number,
		stale: boolean,
		ageSeconds: number,
	): TrackedBus {
		const route = track.route as RouteIndex;
		const { line } = route;
		const prediction = this.predict(track, route, travelSeconds);
		// Past the extrapolation limit the simulated bus stands still.
		if (stale) prediction.speedMps = 0;
		const gap = arcDelta(line, track.displayedArc, prediction.arc);

		if (Math.abs(gap) > SNAP_M) {
			track.displayedArc = prediction.arc;
			track.displayedSpeedMps = prediction.speedMps;
		} else if (prediction.speedMps === 0 && gap <= 0) {
			// The bus is standing and the marker has reached it: brake hard.
			track.displayedSpeedMps = 0;
		} else if (dtSeconds > 0) {
			let targetSpeed: number;

			if (gap >= 0) {
				const catchUp = Math.min(
					gap / CATCH_UP_S,
					Math.max(prediction.speedMps * CATCH_UP_FACTOR, MIN_CATCH_UP_MPS),
				);
				targetSpeed = prediction.speedMps + catchUp;
			} else {
				targetSpeed = prediction.speedMps * Math.max(MIN_SLOW_FACTOR, 1 + gap / SLOW_WINDOW_M);
			}

			const blend = 1 - Math.exp((-dtSeconds * 1000) / ACCEL_TAU_MS);
			track.displayedSpeedMps += (targetSpeed - track.displayedSpeedMps) * blend;

			const step = track.displayedSpeedMps * dtSeconds;
			// Never overshoot a prediction that is standing still.
			const advance = gap >= 0 && prediction.speedMps === 0 ? Math.min(step, gap) : step;
			track.displayedArc = normalizeArc(line, track.displayedArc + advance);
		}

		const { position, heading } = pointAtArc(line, track.displayedArc);
		track.displayedPosition = position;
		track.heading = heading;

		const next = stopsAhead(route, track.displayedArc).at(0) ?? null;
		const dwelling = prediction.dwelling && Math.abs(gap) <= AT_STOP_M;

		return {
			bus: track.bus,
			position,
			heading,
			speedMps: track.displayedSpeedMps,
			onRoute: true,
			stale,
			dwelling,
			ageSeconds,
			nextStop: next?.stop ?? null,
			metersToNextStop: next?.meters ?? null,
			etaSeconds: next ? this.etaSeconds(track, next.meters, 0) : null,
		};
	}

	// Road time at the bus's pace, plus a dwell at every stop it passes first.
	private etaSeconds(track: Track, meters: number, stopsBetween: number): number {
		return meters / Math.max(effectiveSpeedOf(track), MIN_MOVING_MPS) + stopsBetween * DWELL_S;
	}

	/** Every bus on a route serving the stop, soonest first, with the road it still has to cover. */
	arrivalsAt(stopId: number, nowMs: number): StopArrival[] {
		const arrivals: StopArrival[] = [];

		for (const track of this.tracks.values()) {
			const route = track.route;
			const target = route?.stops.find((entry) => entry.stop.id === stopId);
			if (!route || !target) continue;

			const arrival = this.arrivalFor(track, route, target, nowMs);
			if (arrival) arrivals.push(arrival);
		}

		return arrivals.toSorted((a, b) => (a.etaSeconds ?? Infinity) - (b.etaSeconds ?? Infinity));
	}

	/** The stops a bus will reach next, nearest first. */
	stopsAheadOf(busId: number, nowMs: number, count: number): StopArrival[] {
		const track = this.tracks.get(busId);
		const route = track?.route;
		if (!track || !route) return [];

		return stopsAhead(route, track.displayedArc)
			.slice(0, count)
			.flatMap((entry) => this.arrivalFor(track, route, entry, nowMs) ?? []);
	}

	private arrivalFor(
		track: Track,
		route: RouteIndex,
		target: { stop: BusStop; arc: number },
		nowMs: number,
	): StopArrival | null {
		const metersAhead = arcAhead(route.line, track.displayedArc, target.arc);
		if (!Number.isFinite(metersAhead)) return null;

		const stopsBetween = stopsAhead(route, track.displayedArc).filter(
			(entry) => entry.meters > AT_STOP_M && entry.meters < metersAhead,
		).length;
		const ageSeconds = Math.max(0, (nowMs - track.anchorTimeMs) / 1000);

		return {
			bus: track.bus,
			stop: target.stop,
			metersAhead,
			stopsBetween,
			etaSeconds: this.etaSeconds(track, metersAhead, stopsBetween),
			stale: ageSeconds > MAX_EXTRAPOLATION_S,
			path: sliceArc(route.line, track.displayedArc, target.arc),
		};
	}
}
