import { useEffect, useEffectEvent } from "react";

import { useMap } from "@/components/ui/map";

// Slow tiles should not keep the rider staring at the loader forever.
const MAX_WAIT_MS = 10_000;

/**
 * Calls `onDrawn` once the map has finished drawing after `ready` turns on,
 * so the loader can lift off a complete map.
 */
export function MapFirstDraw({ ready, onDrawn }: { ready: boolean; onDrawn: () => void }) {
	const { map, isLoaded } = useMap();
	const drawn = useEffectEvent(onDrawn);

	useEffect(() => {
		if (!map || !isLoaded || !ready) return;

		const finish = () => {
			clearTimeout(timer);
			map.off("idle", finish);
			drawn();
		};
		const timer = setTimeout(finish, MAX_WAIT_MS);

		map.on("idle", finish);

		return () => {
			clearTimeout(timer);
			map.off("idle", finish);
		};
	}, [map, isLoaded, ready]);

	return null;
}
