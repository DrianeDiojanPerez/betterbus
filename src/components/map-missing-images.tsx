import { useEffect } from "react";

import { useMap } from "@/components/ui/map";

const BLANK = { width: 1, height: 1, data: new Uint8Array(4) };

/**
 * The OpenFreeMap styles name a few icons their sprite does not ship. Give
 * those names an empty image so MapLibre stops warning about each one.
 */
export function MapMissingImages() {
	const { map } = useMap();

	useEffect(() => {
		if (!map) return;

		const fill = ({ id }: { id: string }) => {
			if (!map.hasImage(id)) map.addImage(id, BLANK);
		};

		map.on("styleimagemissing", fill);

		return () => {
			map.off("styleimagemissing", fill);
		};
	}, [map]);

	return null;
}
