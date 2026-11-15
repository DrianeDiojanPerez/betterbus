import { Glass } from "glisse";

import { useLiquidGlass, usePanelTheme } from "@/lib/settings";
import { cn } from "@/lib/utils";

/**
 * The glass under anything floating over the map, in the panel theme: glisse's
 * Liquid Glass, light or dark, with its bent, lit rim, or the app's frosted
 * glass for riders who pick it.
 */
export function PanelGlass({ className, ...props }: React.ComponentProps<"div">) {
	const theme = usePanelTheme();

	if (useLiquidGlass()) {
		return <Glass data-theme={theme} className={cn(theme, className)} {...props} />;
	}

	return <div className={cn(theme, "glass", className)} {...props} />;
}
