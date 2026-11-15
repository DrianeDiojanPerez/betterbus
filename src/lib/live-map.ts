import { queryOptions } from "@tanstack/react-query";

import { withSavedRouteLines } from "@/lib/route-line-cache";
import { getLiveMap, getSavedRoutes } from "@/server/live-map";

export const LIVE_MAP_POLL_MS = 5000;

export function liveMapQueryOptions() {
	return queryOptions({
		queryKey: ["live-map"],
		queryFn: async () => withSavedRouteLines(await getLiveMap()),
		refetchInterval: LIVE_MAP_POLL_MS,
		staleTime: LIVE_MAP_POLL_MS,
	});
}

export function savedRoutesQueryOptions() {
	return queryOptions({
		queryKey: ["saved-routes"],
		queryFn: () => getSavedRoutes(),
		staleTime: Infinity,
	});
}
