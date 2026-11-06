import { useEffect, useState } from "react";

import { BusTracker, type TrackedBus } from "@/lib/bus-tracker";
import type { LiveMap } from "@/server/live-map";

const FRAME_MS = 50;

export function useBusTracks(
	feed: LiveMap | undefined,
	receivedAtMs: number,
): { tracks: TrackedBus[]; tracker: BusTracker; now: number } {
	const [tracker] = useState(() => new BusTracker());
	const [snapshot, setSnapshot] = useState<{ tracks: TrackedBus[]; now: number }>({
		tracks: [],
		now: 0,
	});

	useEffect(() => {
		if (feed) tracker.update(feed, receivedAtMs);
	}, [tracker, feed, receivedAtMs]);

	useEffect(() => {
		let frame = 0;
		let last = 0;

		const loop = (time: number) => {
			if (time - last >= FRAME_MS) {
				last = time;
				const now = Date.now();
				setSnapshot({ tracks: tracker.tick(now), now });
			}
			frame = requestAnimationFrame(loop);
		};

		frame = requestAnimationFrame(loop);

		return () => cancelAnimationFrame(frame);
	}, [tracker]);

	return { tracks: snapshot.tracks, tracker, now: snapshot.now };
}
