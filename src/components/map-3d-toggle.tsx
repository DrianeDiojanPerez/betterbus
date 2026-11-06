import { useCallback, useEffect } from "react";

import { useMap } from "@/components/ui/map";
import { cn } from "@/lib/utils";

const TILT_DEG = 55;
const EASE_MS = 600;

/**
 * Keeps the map flat until asked. Right-drag tilts and rotates only while
 * 3D is on; turning it off eases the view back to flat and north-up.
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

		if (enabled) {
			map.dragRotate.enable();
			map.touchPitch.enable();
			map.touchZoomRotate.enableRotation();
			map.keyboard.enableRotation();
		} else {
			map.dragRotate.disable();
			map.touchPitch.disable();
			map.touchZoomRotate.disableRotation();
			map.keyboard.disableRotation();
		}
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
				title={enabled ? "Back to flat map" : "Tilt and rotate with right-drag"}
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
