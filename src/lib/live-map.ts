import { queryOptions } from "@tanstack/react-query";

import { getLiveMap } from "@/server/live-map";

export const LIVE_MAP_POLL_MS = 5000;

export function liveMapQueryOptions() {
	return queryOptions({
		queryKey: ["live-map"],
		queryFn: () => getLiveMap(),
		refetchInterval: LIVE_MAP_POLL_MS,
		staleTime: LIVE_MAP_POLL_MS,
	});
}
