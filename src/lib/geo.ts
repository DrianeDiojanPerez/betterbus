export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export function haversineMeters(a: LngLat, b: LngLat): number {
	const [lng1, lat1] = a;
	const [lng2, lat2] = b;
	const dLat = (lat2 - lat1) * DEG;
	const dLng = (lng2 - lng1) * DEG;
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;

	return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingDegrees(from: LngLat, to: LngLat): number {
	const [lng1, lat1] = from;
	const [lng2, lat2] = to;
	const dLng = (lng2 - lng1) * DEG;
	const y = Math.sin(dLng) * Math.cos(lat2 * DEG);
	const x =
		Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
		Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLng);

	return (((Math.atan2(y, x) / DEG) % 360) + 360) % 360;
}

export function moveAlongBearing(from: LngLat, bearing: number, meters: number): LngLat {
	const [lng, lat] = from;
	const angular = meters / EARTH_RADIUS_M;
	const lat1 = lat * DEG;
	const brng = bearing * DEG;
	const lat2 = Math.asin(
		Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brng),
	);
	const lng2 =
		lng * DEG +
		Math.atan2(
			Math.sin(brng) * Math.sin(angular) * Math.cos(lat1),
			Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
		);

	return [lng2 / DEG, lat2 / DEG];
}

export type Polyline = {
	points: LngLat[];
	cumulative: number[];
	length: number;
	closed: boolean;
};

// A closed line wraps from its last point back to its first.
export function buildPolyline(points: LngLat[], closed: boolean): Polyline {
	const cumulative = [0];

	for (let i = 1; i < points.length; i++) {
		cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
	}

	let length = cumulative[cumulative.length - 1];

	if (closed && points.length > 1) {
		length += haversineMeters(points[points.length - 1], points[0]);
	}

	return { points, cumulative, length, closed };
}

function segmentCount(line: Polyline): number {
	return line.closed ? line.points.length : line.points.length - 1;
}

function segmentEnds(line: Polyline, index: number): [LngLat, LngLat] {
	return [line.points[index], line.points[(index + 1) % line.points.length]];
}

export type Projection = {
	arc: number;
	snapped: LngLat;
	distance: number;
	heading: number;
};

// Works on a flat approximation around the point, which is accurate to well
// under a metre at the scale of a city.
export function projectOntoPolyline(line: Polyline, point: LngLat): Projection {
	const [lng0, lat0] = point;
	const scaleX = Math.cos(lat0 * DEG) * DEG * EARTH_RADIUS_M;
	const scaleY = DEG * EARTH_RADIUS_M;
	const toLocal = ([lng, lat]: LngLat) => [(lng - lng0) * scaleX, (lat - lat0) * scaleY];

	let best: Projection = { arc: 0, snapped: line.points[0], distance: Infinity, heading: 0 };

	for (let i = 0; i < segmentCount(line); i++) {
		const [a, b] = segmentEnds(line, i);
		const [ax, ay] = toLocal(a);
		const [bx, by] = toLocal(b);
		const dx = bx - ax;
		const dy = by - ay;
		const lengthSq = dx * dx + dy * dy;
		const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lengthSq));
		const px = ax + dx * t;
		const py = ay + dy * t;
		const distance = Math.hypot(px, py);

		if (distance < best.distance) {
			const segmentLength = Math.sqrt(lengthSq);
			best = {
				arc: line.cumulative[i] + segmentLength * t,
				snapped: [lng0 + px / scaleX, lat0 + py / scaleY],
				distance,
				heading: bearingDegrees(a, b),
			};
		}
	}

	return best;
}

export function normalizeArc(line: Polyline, arc: number): number {
	if (line.closed) {
		return ((arc % line.length) + line.length) % line.length;
	}

	return Math.max(0, Math.min(line.length, arc));
}

export function pointAtArc(line: Polyline, arc: number): { position: LngLat; heading: number } {
	const target = normalizeArc(line, arc);
	const segments = segmentCount(line);

	for (let i = 0; i < segments; i++) {
		const start = line.cumulative[i];
		const end = i + 1 < line.cumulative.length ? line.cumulative[i + 1] : line.length;

		if (target <= end || i === segments - 1) {
			const [a, b] = segmentEnds(line, i);
			const span = end - start;
			const t = span === 0 ? 0 : (target - start) / span;

			return {
				position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
				heading: bearingDegrees(a, b),
			};
		}
	}

	return { position: line.points[0], heading: 0 };
}

// Signed metres from one arc to another, the short way round on a loop.
export function arcDelta(line: Polyline, from: number, to: number): number {
	const delta = to - from;

	if (!line.closed) return delta;

	const half = line.length / 2;

	if (delta > half) return delta - line.length;
	if (delta < -half) return delta + line.length;

	return delta;
}

// Metres of road from one arc to another going forward. A point behind on an
// open line is unreachable, so the distance is infinite.
export function arcAhead(line: Polyline, from: number, to: number): number {
	const delta = to - from;

	if (line.closed) {
		return ((delta % line.length) + line.length) % line.length;
	}

	return delta < 0 ? Infinity : delta;
}

// The vertices between two arcs, going forward, with exact start and end
// points so the slice begins and ends on the line.
export function sliceArc(line: Polyline, from: number, to: number): LngLat[] {
	const start = normalizeArc(line, from);
	const ahead = arcAhead(line, from, to);

	if (!Number.isFinite(ahead) || ahead <= 0) return [pointAtArc(line, start).position];

	const result: LngLat[] = [pointAtArc(line, start).position];
	const count = line.points.length;
	let index = line.cumulative.findIndex((arc) => arc > start);
	if (index === -1) index = line.closed ? 0 : count;

	for (let visited = 0; visited < count && index < count; visited++) {
		const offset = arcAhead(line, start, line.cumulative[index]);
		if (offset >= ahead) break;
		if (offset > 0) result.push(line.points[index]);

		index++;
		if (index === count && line.closed) index = 0;
	}

	result.push(pointAtArc(line, start + ahead).position);

	return result;
}
