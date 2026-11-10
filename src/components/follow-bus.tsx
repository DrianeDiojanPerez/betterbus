import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";

import { useMap } from "@/components/ui/map";
import { useIsMobile } from "@/hooks/use-mobile";
import type { LngLat } from "@/lib/geo";

const FOLLOW_ZOOM = 16;
const FLY_MS = 1200;
// How long the camera takes to close most of the gap to a moving bus. Long
// enough to soak up the marker's small jumps, short enough to stay on it.
const SETTLE_MS = 700;
// The bus panel covers the left side on wide screens and the bottom on phones.
const SHEET_WIDTH_PX = 396;
const DRAWER_SHARE = 0.55;

/**
 * Flies to a bus and keeps it in the middle of the part of the map the bus
 * panel leaves open. Dragging the map hands the camera back to the rider.
 */
export function FollowBus({
	position,
	request,
	onRelease,
}: {
	position: LngLat | null;
	request: number | null;
	onRelease: () => void;
}) {
	const { map } = useMap();
	const isMobile = useIsMobile();
	const positionRef = useRef(position);
	const handOver = useEffectEvent(onRelease);

	useLayoutEffect(() => {
		positionRef.current = position;
	}, [position]);

	useEffect(() => {
		if (!map || request === null || !positionRef.current) return;

		const focus = (): { x: number; y: number } => {
			const { clientWidth: width, clientHeight: height } = map.getContainer();

			if (isMobile) return { x: width / 2, y: (height * (1 - DRAWER_SHARE)) / 2 };
			if (width > SHEET_WIDTH_PX * 2) return { x: (width + SHEET_WIDTH_PX) / 2, y: height / 2 };

			return { x: width / 2, y: height / 2 };
		};

		const clock = { frame: 0, last: 0 };

		const step = (time: number) => {
			const target = positionRef.current;
			const dt = clock.last ? time - clock.last : 16;
			clock.last = time;

			// A gesture or another camera move is running; pulling now would cut it short.
			if (target && !map.isMoving()) {
				const { clientWidth: width, clientHeight: height } = map.getContainer();
				const bus = map.project(target);
				const spot = focus();
				const pull = 1 - Math.exp(-dt / SETTLE_MS);
				const dx = (bus.x - spot.x) * pull;
				const dy = (bus.y - spot.y) * pull;

				if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
					map.jumpTo({ center: map.unproject([width / 2 + dx, height / 2 + dy]) });
				}
			}

			clock.frame = requestAnimationFrame(step);
		};

		const release = () => {
			cancelAnimationFrame(clock.frame);
			handOver();
		};

		const { clientWidth: width, clientHeight: height } = map.getContainer();
		const spot = focus();

		map.on("dragstart", release);
		map.easeTo({
			center: positionRef.current,
			zoom: FOLLOW_ZOOM,
			offset: [spot.x - width / 2, spot.y - height / 2],
			duration: FLY_MS,
			essential: true,
		});
		// The loop waits out the flight above, since the map is moving until it lands.
		clock.frame = requestAnimationFrame(step);

		return () => {
			cancelAnimationFrame(clock.frame);
			map.off("dragstart", release);
		};
	}, [map, request, isMobile]);

	return null;
}
