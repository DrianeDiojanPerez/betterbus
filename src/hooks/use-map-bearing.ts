import { useEffect, useState } from "react";

import { useMap } from "@/components/ui/map";

/** The map's current bearing in whole degrees, kept in sync as the camera moves. */
export function useMapBearing(): number {
	const { map } = useMap();
	// Read now, so a card opened on a turned map starts on the right side.
	const [bearing, setBearing] = useState(() => Math.round(map?.getBearing() ?? 0));

	useEffect(() => {
		if (!map) return;

		const sync = () => setBearing(Math.round(map.getBearing()));

		sync();
		map.on("move", sync);

		return () => {
			map.off("move", sync);
		};
	}, [map]);

	return bearing;
}
