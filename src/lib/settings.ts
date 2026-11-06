import { useSyncExternalStore } from "react";

export const SETTINGS_STORAGE_KEY = "betterbus-settings";

export type ThemeSetting = "system" | "light" | "dark";
export type MapStyleSetting = "liberty" | "bright" | "positron" | "colorful" | "slate" | "night";
export type Settings = { theme: ThemeSetting; mapStyle: MapStyleSetting };

export const DEFAULT_SETTINGS: Settings = { theme: "system", mapStyle: "liberty" };

const STYLE_BASE = "https://tiles.openfreemap.org/styles/";

// Every choice is a pair: a light map for light mode, a dark one for dark mode.
export const MAP_STYLE_PAIRS: Record<MapStyleSetting, { light: string; dark: string }> = {
	liberty: { light: `${STYLE_BASE}liberty`, dark: `${STYLE_BASE}dark` },
	bright: { light: `${STYLE_BASE}bright`, dark: `${STYLE_BASE}fiord` },
	positron: { light: `${STYLE_BASE}positron`, dark: `${STYLE_BASE}dark` },
	colorful: {
		light: "https://tiles.versatiles.org/assets/styles/colorful/style.json",
		dark: "https://tiles.versatiles.org/assets/styles/eclipse/style.json",
	},
	slate: { light: `${STYLE_BASE}positron`, dark: "/map-styles/slate.json" },
	night: { light: `${STYLE_BASE}positron`, dark: "/map-styles/night.json" },
};

export const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
	{ value: "system", label: "Auto" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

export const MAP_STYLE_OPTIONS: { value: MapStyleSetting; label: string; hint: string }[] = [
	{ value: "liberty", label: "Liberty", hint: "Colorful by day, black at night" },
	{ value: "bright", label: "Bright", hint: "Clean by day, deep blue at night" },
	{ value: "positron", label: "Positron", hint: "Soft grey by day, black at night" },
	{ value: "colorful", label: "Colorful", hint: "Warm tones by day, charcoal at night" },
	{ value: "slate", label: "Slate", hint: "Soft grey by day, slate blue at night" },
	{ value: "night", label: "Night", hint: "Soft grey by day, charcoal black at night" },
];

/**
 * Runs before hydration so the first paint already has the right theme.
 * Mirrors readSettings and resolveTheme below.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)})||"{}");var t=s.theme;var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";if(d)r.classList.add("dark")}catch(e){}})()`;

const listeners = new Set<() => void>();
let cached: Settings | null = null;

function isTheme(value: unknown): value is ThemeSetting {
	return THEME_OPTIONS.some((option) => option.value === value);
}

function isMapStyle(value: unknown): value is MapStyleSetting {
	return MAP_STYLE_OPTIONS.some((option) => option.value === value);
}

function readSettings(): Settings {
	if (cached) return cached;

	let stored: Partial<Record<keyof Settings, unknown>> = {};
	try {
		stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}") as typeof stored;
	} catch {
		// Storage can be blocked or hold junk; the defaults still apply.
	}

	cached = {
		theme: isTheme(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme,
		mapStyle: isMapStyle(stored.mapStyle) ? stored.mapStyle : DEFAULT_SETTINGS.mapStyle,
	};

	return cached;
}

function systemQuery() {
	return window.matchMedia("(prefers-color-scheme: dark)");
}

export function resolveTheme(setting: ThemeSetting): "light" | "dark" {
	if (setting !== "system") return setting;

	return systemQuery().matches ? "dark" : "light";
}

// The data attribute tells the map which style to load, in both directions.
function applyTheme(setting: ThemeSetting) {
	const theme = resolveTheme(setting);
	const root = document.documentElement;
	root.classList.toggle("dark", theme === "dark");
	root.dataset.theme = theme;
}

function subscribe(listener: () => void) {
	const query = systemQuery();
	const onSystemChange = () => {
		applyTheme(readSettings().theme);
		listener();
	};

	listeners.add(listener);
	query.addEventListener("change", onSystemChange);

	return () => {
		listeners.delete(listener);
		query.removeEventListener("change", onSystemChange);
	};
}

export function updateSettings(patch: Partial<Settings>) {
	cached = { ...readSettings(), ...patch };

	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(cached));
	} catch {
		// Without storage the choice still applies for this visit.
	}

	applyTheme(cached.theme);
	for (const listener of listeners) listener();
}

export function useSettings(): Settings {
	return useSyncExternalStore(subscribe, readSettings, () => DEFAULT_SETTINGS);
}

export function useResolvedTheme(): "light" | "dark" {
	return useSyncExternalStore(
		subscribe,
		() => resolveTheme(readSettings().theme),
		() => "light",
	);
}
