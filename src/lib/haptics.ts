import { WebHaptics, type HapticInput } from "web-haptics";

let haptics: WebHaptics | null = null;

/**
 * A short buzz under the rider's finger. Phones and tablets only: a mouse
 * click has nothing to feel. Call it from a tap handler, since browsers only
 * allow vibration in answer to the user.
 */
export function haptic(input: HapticInput) {
	if (typeof window === "undefined") return;
	if (!window.matchMedia("(pointer: coarse)").matches) return;

	haptics ??= new WebHaptics();
	void haptics.trigger(input);
}
