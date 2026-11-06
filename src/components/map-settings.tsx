import { Monitor, Moon, Settings2, Sun, X } from "lucide-react";

import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import {
	MAP_STYLE_OPTIONS,
	THEME_OPTIONS,
	updateSettings,
	useSettings,
	type MapStyleSetting,
	type ThemeSetting,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

const THEME_ICONS: Record<ThemeSetting, React.ReactNode> = {
	system: <Monitor />,
	light: <Sun />,
	dark: <Moon />,
};

/**
 * Settings rise from the bottom like the bus panel and leave the map
 * uncovered, so a map style shows on the real map as soon as it is tapped.
 */
export function MapSettings({ className }: { className?: string }) {
	const settings = useSettings();

	return (
		<Drawer modal={false} disablePointerDismissal showSwipeHandle>
			<div
				className={cn(
					"flex flex-col overflow-hidden rounded-full text-foreground glass [&>button+button]:border-t [&>button+button]:border-border/60",
					className,
				)}
			>
				<DrawerTrigger
					aria-label="Settings"
					title="Settings"
					render={
						<button
							type="button"
							className={cn(
								"flex size-11 items-center justify-center transition-transform hover:bg-foreground/5 active:scale-90",
								"focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
							)}
						/>
					}
				>
					<Settings2 className="size-5" />
				</DrawerTrigger>
			</div>
			<DrawerContent className="sm:mx-auto sm:w-full sm:max-w-xl">
				<DrawerHeader className="relative">
					<div className="flex flex-col gap-1 pr-10 text-left">
						<DrawerTitle>Settings</DrawerTitle>
						<DrawerDescription>Saved on this device.</DrawerDescription>
					</div>
					<DrawerClose
						aria-label="Close"
						render={
							<button
								type="button"
								className="absolute top-3 right-3 hidden size-8 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-fine:grid"
							/>
						}
					>
						<X className="size-4" />
					</DrawerClose>
				</DrawerHeader>
				<div className="flex flex-col gap-6 overflow-y-auto px-4 pt-5 pb-6">
					<section className="flex flex-col gap-2">
						<h3 className="text-xs font-semibold text-muted-foreground uppercase">Appearance</h3>
						<div
							role="radiogroup"
							aria-label="Appearance"
							className="grid grid-cols-3 gap-1 rounded-2xl bg-foreground/5 p-1"
						>
							{THEME_OPTIONS.map((option) => {
								const selected = settings.theme === option.value;

								return (
									<button
										key={option.value}
										type="button"
										role="radio"
										aria-checked={selected}
										onClick={() => updateSettings({ theme: option.value })}
										className={cn(
											"flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-5",
											selected
												? "bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{THEME_ICONS[option.value]}
										{option.label}
									</button>
								);
							})}
						</div>
						<p className="text-xs text-muted-foreground">
							{settings.theme === "system"
								? "Follows your device, so it switches when your device does."
								: "Fixed, no matter what your device is set to."}
						</p>
					</section>
					<section className="flex flex-col gap-2">
						<div className="flex items-baseline justify-between gap-3">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase">Map style</h3>
							<span className="text-xs text-muted-foreground">Each follows Appearance</span>
						</div>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							{MAP_STYLE_OPTIONS.map((option) => (
								<StyleCard
									key={option.value}
									value={option.value}
									label={option.label}
									hint={option.hint}
									selected={settings.mapStyle === option.value}
									onSelect={() => updateSettings({ mapStyle: option.value })}
								/>
							))}
						</div>
					</section>
				</div>
			</DrawerContent>
		</Drawer>
	);
}

function StyleCard({
	value,
	label,
	hint,
	selected,
	onSelect,
}: {
	value: MapStyleSetting;
	label: string;
	hint: string;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"flex flex-col gap-2 rounded-2xl border p-2 text-left transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
				selected ? "border-primary ring-2 ring-primary" : "border-border/60",
			)}
		>
			<img
				src={`/map-styles/${value}.webp`}
				alt=""
				width={320}
				height={160}
				className="aspect-2/1 w-full rounded-lg object-cover"
			/>
			<span className="flex flex-col">
				<span className="text-sm font-medium">{label}</span>
				<span className="text-xs text-muted-foreground">{hint}</span>
			</span>
		</button>
	);
}
