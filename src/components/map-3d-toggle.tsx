import { useCallback, useEffect } from "react";

import { useMap } from "@/components/ui/map";
import { cn } from "@/lib/utils";

const TILT_DEG = 55;
const MAX_TILT_DEG = 60;
const EASE_MS = 600;

/**
 * Keeps the map flat until asked. Right-drag always turns the map, and only
 * tilts it while 3D is on; turning 3D off eases back to flat and north-up.
 */
export function Map3dToggle({
	enabled,
	onEnabledChange,
	className,
}: {
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	className?: string;
}) {
	const { map } = useMap();

	useEffect(() => {
		if (!map) return;

		map.dragRotate.enable();
		map.touchZoomRotate.enableRotation();
		map.keyboard.enableRotation();

		if (enabled) {
			map.setMaxPitch(MAX_TILT_DEG);
			map.touchPitch.enable();
			return;
		}

		map.touchPitch.disable();
		// Clamping now would cut the ease back to flat short.
		const lockFlat = () => {
			if (map.getPitch() === 0) map.setMaxPitch(0);
		};
		lockFlat();
		map.on("moveend", lockFlat);
		return () => {
			map.off("moveend", lockFlat);
		};
	}, [map, enabled]);

	const toggle = useCallback(() => {
		if (!map) return;

		map.easeTo(
			enabled
				? { pitch: 0, bearing: 0, duration: EASE_MS }
				: { pitch: TILT_DEG, duration: EASE_MS },
		);
		onEnabledChange(!enabled);
	}, [map, enabled, onEnabledChange]);

	return (
		<div
			className={cn(
				"flex flex-col overflow-hidden rounded-full text-foreground glass [&>button+button]:border-t [&>button+button]:border-border/60",
				className,
			)}
		>
			<button
				type="button"
				onClick={toggle}
				aria-pressed={enabled}
				aria-label={enabled ? "Turn 3D view off" : "Turn 3D view on"}
				title={enabled ? "Back to flat map" : "Tilt with right-drag"}
				className={cn(
					"flex size-11 items-center justify-center text-sm font-semibold transition-all active:scale-90",
					"focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
					enabled ? "bg-foreground text-background" : "hover:bg-foreground/5",
				)}
			>
				3D
			</button>
		</div>
	);
}
