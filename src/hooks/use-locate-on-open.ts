import { useEffect, useEffectEvent } from "react";

const LOCATE_STORAGE_KEY = "betterbus-locate";
// Matches the loading overlay's fade, so the camera only heads for the rider
// once the map is in plain view, not while it shows through the overlay.
const AFTER_REVEAL_MS = 1000;

type Coords = { longitude: number; latitude: number };

/** Notes the rider's answer, so a "no" is not asked again on every visit. */
export function rememberLocateAnswer(answer: "granted" | "denied") {
	try {
		localStorage.setItem(LOCATE_STORAGE_KEY, answer);
	} catch {
		// Without storage the browser's own memory of the answer still applies.
	}
}

function declinedBefore(): boolean {
	try {
		return localStorage.getItem(LOCATE_STORAGE_KEY) === "denied";
	} catch {
		return false;
	}
}

/**
 * Asks for the rider's location once the map is showing, so they need not
 * press the locate button. Riders who said no are left alone; the button
 * still asks.
 */
export function useLocateOnOpen(ready: boolean, onFound: (coords: Coords) => void) {
	const found = useEffectEvent(onFound);

	useEffect(() => {
		if (!ready || !("geolocation" in navigator) || declinedBefore()) return;
		let cancelled = false;

		const ask = () =>
			navigator.geolocation.getCurrentPosition(
				(position) => {
					if (cancelled) return;
					rememberLocateAnswer("granted");
					found({ longitude: position.coords.longitude, latitude: position.coords.latitude });
				},
				(error) => {
					if (error.code === error.PERMISSION_DENIED) rememberLocateAnswer("denied");
				},
				{ timeout: 10_000 },
			);
		const timer = setTimeout(ask, AFTER_REVEAL_MS);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [ready]);
}
