import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { LngLat } from "@/lib/geo";

const FOOT_ROUTE = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
const USER_AGENT = "betterbus (bus map for Belize City)";

const point = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

type FootResponse = {
	code: string;
	routes?: { distance: number; geometry: { coordinates: LngLat[] } }[];
};

export type WalkPath = { path: LngLat[]; meters: number };

/** The walk along the streets from the rider to a stop, or null when the router has none. */
export const getWalkPath = createServerFn({ method: "GET" })
	.validator(z.object({ from: point, to: point }))
	.handler(async ({ data }): Promise<WalkPath | null> => {
		const { from, to } = data;
		const response = await fetch(
			`${FOOT_ROUTE}/${from.join(",")};${to.join(",")}?overview=full&geometries=geojson`,
			{ headers: { "User-Agent": USER_AGENT } },
		);
		if (!response.ok) return null;

		const route = ((await response.json()) as FootResponse).routes?.at(0);
		if (!route) return null;

		return { path: [from, ...route.geometry.coordinates, to], meters: route.distance };
	});
