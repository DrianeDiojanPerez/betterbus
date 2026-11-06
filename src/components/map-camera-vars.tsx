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
		let pitch = "";
		let bearing = "";

		// A pan moves the map on every frame without turning or tilting it, and
		// rewriting the variables would restyle every marker each time.
		const sync = () => {
			const nextPitch = `${map.getPitch()}deg`;
			const nextBearing = `${map.getBearing()}deg`;

			if (nextPitch !== pitch) container.style.setProperty("--map-pitch", (pitch = nextPitch));
			if (nextBearing !== bearing) {
				container.style.setProperty("--map-bearing", (bearing = nextBearing));
			}
		};

		sync();
		map.on("move", sync);

		return () => {
			map.off("move", sync);
		};
	}, [map]);

	return null;
}
