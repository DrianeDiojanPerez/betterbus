import { useEffect, useState } from "react";

import { useMap } from "@/components/ui/map";

/** The map's current bearing in whole degrees, kept in sync as the camera moves. */
export function useMapBearing(): number {
	const { map } = useMap();
	const [bearing, setBearing] = useState(0);

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
