import { useEffect } from "react";

import { useMap } from "@/components/ui/map";

/**
 * Publishes the camera's pitch and bearing as CSS variables on the map
 * container, so marker content aligned to the map can counter-rotate parts
 * of itself to face the viewer.
 */
export function MapCameraVars() {
	const { map } = useMap();

	useEffect(() => {
		if (!map) return;

		const container = map.getContainer();
		const sync = () => {
			container.style.setProperty("--map-pitch", `${map.getPitch()}deg`);
			container.style.setProperty("--map-bearing", `${map.getBearing()}deg`);
		};

		sync();
		map.on("move", sync);

		return () => {
			map.off("move", sync);
		};
	}, [map]);

	return null;
}
