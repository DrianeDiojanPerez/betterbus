import type { LatLng } from "./live-map";

// Spots where the road matcher draws the route down a street the buses do not
// take. Each one swaps that stretch for the street they drive, using its own
// points from OpenStreetMap, checked against a day of recorded bus positions.

const M_PER_DEG = 111_320;

function toMeters(origin: LatLng, point: LatLng): { x: number; y: number } {
	return {
		x: (point.lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180) * M_PER_DEG,
		y: (point.lat - origin.lat) * M_PER_DEG,
	};
}

function distanceToLine(point: LatLng, line: LatLng[]): number {
	const p = toMeters(line[0], point);
	let best = Infinity;

	for (let i = 0; i + 1 < line.length; i++) {
		const a = toMeters(line[0], line[i]);
		const b = toMeters(line[0], line[i + 1]);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lengthSq = dx * dx + dy * dy;
		const t =
			lengthSq === 0
				? 0
				: Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));

		best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
	}

	return best;
}

// Swaps the first run of points that `belongs` claims for `replacement`, as
// long as `wrong` holds for the run.
function replaceRun(
	points: LatLng[],
	belongs: (point: LatLng) => boolean,
	replacement: LatLng[],
	wrong: (run: LatLng[]) => boolean = () => true,
): LatLng[] {
	const start = points.findIndex(belongs);
	if (start === -1) return points;

	let end = start;
	while (end + 1 < points.length && belongs(points[end + 1])) end++;

	if (!wrong(points.slice(start, end + 1))) return points;

	return [...points.slice(0, start), ...replacement, ...points.slice(end + 1)];
}

// A roundabout where the line strays off the ring. Points within 25 m of
// `center`, between `from` and `to` degrees counterclockwise from east, are
// redrawn on `side`, the ring's own points in the order a bus drives them.
type Ring = { center: LatLng; from: number; to: number; side: LatLng[] };

const RINGS: Ring[] = [
	// Therese Felix Roundabout: the line dips below the ring on its south side,
	// from the Central American Blvd entry to the Cemetery Rd exit.
	{
		center: { lat: 17.495698, lng: -88.19901 },
		from: -141,
		to: -30,
		side: [
			{ lat: 17.4955977, lng: -88.199137 },
			{ lat: 17.4955696, lng: -88.1991006 },
			{ lat: 17.4955528, lng: -88.1990572 },
			{ lat: 17.4955487, lng: -88.1990106 },
			{ lat: 17.4955577, lng: -88.1989647 },
			{ lat: 17.495579, lng: -88.1989235 },
			{ lat: 17.4956107, lng: -88.1988906 },
			{ lat: 17.4956197, lng: -88.1988842 },
		],
	},
	// Philip Goldson Highway and Chetumal Street: the line zigzags outside the
	// ring on its west side, from the highway round to the Chetumal St exit.
	{
		center: { lat: 17.51335, lng: -88.22087 },
		from: 125,
		to: -128,
		side: [
			{ lat: 17.5134718, lng: -88.2209794 },
			{ lat: 17.5134479, lng: -88.221001 },
			{ lat: 17.5134233, lng: -88.2210171 },
			{ lat: 17.5133909, lng: -88.2210281 },
			{ lat: 17.5133593, lng: -88.2210318 },
			{ lat: 17.5133285, lng: -88.2210295 },
			{ lat: 17.513307, lng: -88.2210237 },
			{ lat: 17.5132869, lng: -88.221015 },
		],
	},
];

function fixRing(points: LatLng[], { center, from, to, side }: Ring): LatLng[] {
	const span = (((to - from) % 360) + 360) % 360;
	const onSide = (point: LatLng) => {
		const { x, y } = toMeters(center, point);
		const angle = (Math.atan2(y, x) * 180) / Math.PI;
		const along = (((angle - from) % 360) + 360) % 360;

		return Math.hypot(x, y) < 25 && along > 0 && along < span;
	};

	return replaceRun(points, onSide, side);
}

type Area = { south: number; north: number; west: number; east: number };

// A street the buses drive straight along, where the line turns off it and
// comes back. Inside `area`, points more than 3 m off `street` (or `strayM`,
// if smaller) belong to the
// detour; a run that strays `strayM` (15 m unless set) or more is swapped
// for `gap`, the part of the street it skipped. Closer than that is only GPS
// wobble.
type Detour = { area: Area; street: LatLng[]; gap: LatLng[]; strayM?: number };

const DETOURS: Detour[] = [
	// Albert Street West. The line turns onto Albert Street and comes back
	// along Cockburn Lane.
	{
		area: { south: 17.4893, north: 17.4902, west: -88.1885, east: -88.1878 },
		street: [
			{ lat: 17.4901724, lng: -88.1880296 },
			{ lat: 17.4901372, lng: -88.1880514 },
			{ lat: 17.4900947, lng: -88.1880823 },
			{ lat: 17.4900379, lng: -88.1881144 },
			{ lat: 17.4896604, lng: -88.1882929 },
			{ lat: 17.4896088, lng: -88.1883173 },
			{ lat: 17.4894519, lng: -88.1883966 },
			{ lat: 17.489149, lng: -88.1885685 },
			{ lat: 17.4890667, lng: -88.1886192 },
			{ lat: 17.4888198, lng: -88.1887715 },
			{ lat: 17.4887758, lng: -88.1888011 },
		],
		gap: [
			{ lat: 17.4901372, lng: -88.1880514 },
			{ lat: 17.4900947, lng: -88.1880823 },
			{ lat: 17.4900379, lng: -88.1881144 },
			{ lat: 17.4896604, lng: -88.1882929 },
			{ lat: 17.4896088, lng: -88.1883173 },
			{ lat: 17.4894519, lng: -88.1883966 },
		],
	},
	// Water Lane. The line goes up Carl Lindberg Rogers Street and comes back
	// down East Canal Street.
	{
		area: { south: 17.4954, north: 17.4962, west: -88.1885, east: -88.1876 },
		street: [
			{ lat: 17.4952666, lng: -88.1874092 },
			{ lat: 17.4952744, lng: -88.1874293 },
			{ lat: 17.4952803, lng: -88.187449 },
			{ lat: 17.4952843, lng: -88.1874699 },
			{ lat: 17.4953128, lng: -88.1877643 },
			{ lat: 17.4953926, lng: -88.1883647 },
			{ lat: 17.4954014, lng: -88.1884022 },
			{ lat: 17.4954059, lng: -88.1884232 },
			{ lat: 17.4954085, lng: -88.1884343 },
			{ lat: 17.4954149, lng: -88.1884642 },
		],
		gap: [
			{ lat: 17.4952744, lng: -88.1874293 },
			{ lat: 17.4952803, lng: -88.187449 },
			{ lat: 17.4952843, lng: -88.1874699 },
			{ lat: 17.4953128, lng: -88.1877643 },
			{ lat: 17.4953926, lng: -88.1883647 },
		],
	},
	// Vernon Street. The line goes up Mosul Street and comes back down East
	// Collet Canal Street.
	{
		area: { south: 17.49665, north: 17.4975, west: -88.1922, east: -88.1907 },
		street: [
			{ lat: 17.4964605, lng: -88.190965 },
			{ lat: 17.4965111, lng: -88.1914059 },
			{ lat: 17.4966254, lng: -88.1920314 },
			{ lat: 17.4966359, lng: -88.1920827 },
			{ lat: 17.4966439, lng: -88.1921211 },
		],
		gap: [
			{ lat: 17.4965111, lng: -88.1914059 },
			{ lat: 17.4966254, lng: -88.1920314 },
		],
	},
	// Baymen Avenue from Calle al Mar to Saint Joseph Street. The line is one
	// long straight here and ends 5 m east of the road.
	{
		area: { south: 17.503, north: 17.5043, west: -88.1906, east: -88.1899 },
		street: [
			{ lat: 17.5022945, lng: -88.1903697 },
			{ lat: 17.5032743, lng: -88.1902915 },
			{ lat: 17.5034722, lng: -88.1902948 },
			{ lat: 17.5040465, lng: -88.1903189 },
			{ lat: 17.5042217, lng: -88.1903095 },
			{ lat: 17.504809, lng: -88.1902143 },
		],
		gap: [
			{ lat: 17.5032743, lng: -88.1902915 },
			{ lat: 17.5034722, lng: -88.1902948 },
			{ lat: 17.5040465, lng: -88.1903189 },
			{ lat: 17.5042217, lng: -88.1903095 },
		],
		strayM: 4,
	},
	// Kelly Street from Wilson Street to Baymen Avenue. The line pokes 3 m up
	// past the Wilson St junction and cuts the Baymen Ave corner 4 m to the east.
	{
		area: { south: 17.5021, north: 17.5026, west: -88.1905, east: -88.18995 },
		street: [
			{ lat: 17.502195, lng: -88.1900424 },
			{ lat: 17.5022503, lng: -88.1902242 },
			{ lat: 17.5022945, lng: -88.1903697 },
			{ lat: 17.5032743, lng: -88.1902915 },
		],
		gap: [
			{ lat: 17.5022503, lng: -88.1902242 },
			{ lat: 17.5022945, lng: -88.1903697 },
		],
		strayM: 2,
	},
	// The corner of Mosul Street and Vernon Street. The line turns 1.5 m north
	// of the junction, so it runs off the road along Vernon St.
	{
		area: { south: 17.49645, north: 17.4965, west: -88.191, east: -88.19092 },
		street: [
			{ lat: 17.4951463, lng: -88.1912852 },
			{ lat: 17.4964605, lng: -88.190965 },
			{ lat: 17.4965111, lng: -88.1914059 },
		],
		gap: [],
		strayM: 1,
	},
];

function fixDetour(points: LatLng[], { area, street, gap, strayM = 15 }: Detour): LatLng[] {
	const onDetour = (point: LatLng) =>
		point.lat > area.south &&
		point.lat < area.north &&
		point.lng > area.west &&
		point.lng < area.east &&
		distanceToLine(point, street) > Math.min(3, strayM);
	const strays = (run: LatLng[]) => run.some((point) => distanceToLine(point, street) > strayM);

	return replaceRun(points, onDetour, gap, strays);
}

export function fixRouteLine(points: LatLng[]): LatLng[] {
	return DETOURS.reduce(fixDetour, RINGS.reduce(fixRing, points));
}
