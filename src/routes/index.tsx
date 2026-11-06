import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bus, ChevronRight, Gauge, LocateFixed, Navigation2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ArrivalsSkeleton, StopsAheadSkeleton } from "@/components/live-map-skeleton";
import { Map3dToggle } from "@/components/map-3d-toggle";
import { MapCameraVars } from "@/components/map-camera-vars";
import { MapMissingImages } from "@/components/map-missing-images";
import { MapSettings } from "@/components/map-settings";
import { Button } from "@/components/ui/button";
import {
	Map,
	MapControls,
	MapMarker,
	MapRoute,
	MarkerContent,
	MarkerTooltip,
	useMap,
} from "@/components/ui/map";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "@/components/ui/drawer";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@/components/ui/sheet";
import { useMapBearing } from "@/hooks/use-map-bearing";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBusTracks } from "@/hooks/use-bus-tracks";
import type { StopArrival, TrackedBus } from "@/lib/bus-tracker";
import { haversineMeters, type LngLat } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { liveMapQueryOptions } from "@/lib/live-map";
import { MAP_STYLE_PAIRS, useSettings } from "@/lib/settings";
import type { BusRoute, BusStop, LiveBus } from "@/server/live-map";

type ViewSearch = { lng?: number; lat?: number; zoom?: number; pitch?: number; stop?: number };

function finite(value: unknown): number | undefined {
	const parsed = typeof value === "string" ? Number(value) : value;

	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): ViewSearch => ({
		lng: finite(search.lng),
		lat: finite(search.lat),
		zoom: finite(search.zoom),
		pitch: finite(search.pitch),
		stop: finite(search.stop),
	}),
	// No loader on purpose: the browser fetches the feed after the page lands.
	component: LiveMapPage,
});

const BELIZE_CITY: [number, number] = [-88.19, 17.5];
const DEFAULT_ZOOM = 13.5;
// A brisk walk, with a third extra for streets not running straight to the stop.
const WALK_MPS = 1.35;
const WALK_DETOUR = 1.3;
const FALLBACK_ROUTE_COLOR = "#2563eb";
const REVEAL_MS = 700;
const ENTER = "animate-in fade-in duration-500";
const ENTER_ZOOM = "animate-in fade-in zoom-in-50 duration-500";

function LiveMapPage() {
	const { data, dataUpdatedAt, error } = useQuery(liveMapQueryOptions());
	const view = Route.useSearch();
	const center: [number, number] =
		view.lng !== undefined && view.lat !== undefined ? [view.lng, view.lat] : BELIZE_CITY;
	const routes = data?.routes ?? [];
	const { tracks, tracker, now } = useBusTracks(data, dataUpdatedAt);
	// Until the first animation frame, show the buses where the server put them.
	const buses = tracks.length > 0 ? tracks : (data?.buses ?? []).map(asParked);
	const nextStopIds = new Set(buses.flatMap((bus) => (bus.nextStop ? [bus.nextStop.id] : [])));
	const [selectedStopId, setSelectedStopId] = useState<number | null>(view.stop ?? null);
	const [threeD, setThreeD] = useState((view.pitch ?? 0) > 0);
	const [userPosition, setUserPosition] = useState<LngLat | null>(null);
	const settings = useSettings();
	const mapStyles = MAP_STYLE_PAIRS[settings.mapStyle];
	const [selectedBusId, setSelectedBusId] = useState<number | null>(null);
	const [busSheetOpen, setBusSheetOpen] = useState(false);
	const selectedStop = findStop(routes, selectedStopId);
	const selectedBus = buses.find((bus) => bus.bus.bus_id === selectedBusId) ?? null;
	const stopsAhead =
		selectedBus && busSheetOpen && now > 0
			? tracker.stopsAheadOf(selectedBus.bus.bus_id, now, 8)
			: [];
	const arrivals = selectedStop && now > 0 ? tracker.arrivalsAt(selectedStop.id, now) : [];
	// Only the soonest bus gets its road drawn; a bus a full loop away would cover the route.
	const nextArrival = arrivals.find((arrival) => !arrival.stale) ?? null;
	// No feed yet, or the tracker has not ticked, so every list would read as empty.
	const settling = !data || now === 0;
	// Markers fade in on the first reveal only. Later remounts, such as the
	// dot-to-pin swap on 3D, would otherwise fade while the camera moves.
	const [revealed, setRevealed] = useState(false);
	const entering = !revealed;

	useEffect(() => {
		if (!data || revealed) return;
		const timer = setTimeout(() => setRevealed(true), REVEAL_MS);

		return () => clearTimeout(timer);
	}, [data, revealed]);

	const handleLocate = useCallback((coords: { longitude: number; latitude: number }) => {
		setUserPosition([coords.longitude, coords.latitude]);
	}, []);
	const openBus = useCallback((busId: number) => {
		setSelectedBusId(busId);
		setBusSheetOpen(true);
	}, []);
	// The stop panel shares the left edge with the bus sheet, so one gives way.
	const pickStop = useCallback((stopId: number) => {
		setSelectedStopId(stopId);
		setBusSheetOpen(false);
	}, []);

	return (
		<div className="relative h-dvh w-full">
			<Map
				center={center}
				zoom={view.zoom ?? DEFAULT_ZOOM}
				pitch={view.pitch ?? 0}
				styles={mapStyles}
				attributionControl={false}
				overlay={
					<div className="absolute top-3 right-3 z-40 flex flex-col gap-2">
						<MapControls
							position="top-right"
							showCompass
							showLocate
							showFullscreen
							onLocate={handleLocate}
							className="static top-auto right-auto"
						/>
						<Map3dToggle enabled={threeD} onEnabledChange={setThreeD} />
						<MapSettings />
					</div>
				}
			>
				<MapCameraVars />
				<MapMissingImages />
				{routes.map((route) => (
					<RouteLine
						key={route.id}
						route={route}
						selectedStopId={selectedStopId}
						nextStopIds={nextStopIds}
						onSelectStop={pickStop}
						threeD={threeD}
						entering={entering}
					/>
				))}
				{nextArrival && nextArrival.path.length > 1 ? (
					<MapRoute
						id="road-ahead"
						coordinates={nextArrival.path}
						color={routeColor(routes, nextArrival.bus.route_id)}
						width={8}
						opacity={1}
					/>
				) : null}
				{userPosition ? (
					<MapMarker longitude={userPosition[0]} latitude={userPosition[1]}>
						<MarkerContent>
							<div className="size-4 animate-in rounded-full bg-here ring-4 ring-here/30 duration-500 zoom-in-50 fade-in" />
						</MarkerContent>
						<MarkerTooltip>You are here</MarkerTooltip>
					</MapMarker>
				) : null}
				{buses.map((bus) => (
					<BusMarker
						key={bus.bus.bus_id}
						tracked={bus}
						threeD={threeD}
						entering={entering}
						color={routeColor(routes, bus.bus.route_id)}
						onOpen={openBus}
					/>
				))}
				<BusPanel
					tracked={selectedBus}
					stopsAhead={stopsAhead}
					settling={settling}
					now={now}
					color={selectedBus ? routeColor(routes, selectedBus.bus.route_id) : FALLBACK_ROUTE_COLOR}
					open={busSheetOpen && selectedBus !== null}
					onOpenChange={setBusSheetOpen}
					onSelectStop={setSelectedStopId}
				/>
			</Map>
			<div
				aria-hidden={data !== undefined}
				className={cn(
					"pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60 transition-opacity duration-700",
					data ? "opacity-0" : "opacity-100",
				)}
			>
				<div className="flex gap-1 loading-dots">
					<span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
					<span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
					<span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
				</div>
			</div>
			{error !== null ? (
				<div className="absolute top-3 left-3 rounded-full px-3 py-1.5 text-xs font-semibold text-destructive glass">
					Feed offline
				</div>
			) : null}
			{selectedStop ? (
				<div className="absolute inset-x-3 bottom-3 rounded-2xl p-4 text-foreground glass sm:inset-x-auto sm:top-3 sm:bottom-auto sm:left-3 sm:w-72">
					<StopPanel
						stop={selectedStop}
						arrivals={arrivals}
						settling={settling}
						now={now}
						userPosition={userPosition}
						onLocate={setUserPosition}
						onClose={() => setSelectedStopId(null)}
					/>
				</div>
			) : null}
		</div>
	);
}

function findStop(routes: BusRoute[], stopId: number | null): BusStop | null {
	if (stopId === null) return null;

	for (const route of routes) {
		const stop = route.stops.find((candidate) => candidate.id === stopId);
		if (stop) return stop;
	}

	return null;
}

function routeColor(routes: BusRoute[], routeId: number | null): string {
	return routes.find((route) => route.id === routeId)?.color ?? FALLBACK_ROUTE_COLOR;
}

function asParked(bus: LiveBus): TrackedBus {
	return {
		bus,
		position: [bus.lng, bus.lat],
		heading: bus.heading,
		speedMps: bus.speed / 3.6,
		onRoute: false,
		stale: false,
		dwelling: false,
		ageSeconds: 0,
		nextStop: null,
		metersToNextStop: null,
		etaSeconds: null,
	};
}

// Stops sit under the bus cards, except the stop a bus is heading to, which
// stays on top so it is never hidden by the card announcing it. The key
// recreates the marker when its layer changes, since the class is set once.
function RouteLine({
	route,
	selectedStopId,
	nextStopIds,
	onSelectStop,
	threeD,
	entering,
}: {
	route: BusRoute;
	selectedStopId: number | null;
	nextStopIds: Set<number>;
	onSelectStop: (stopId: number) => void;
	threeD: boolean;
	entering: boolean;
}) {
	const coordinates = route.geometry.map((point) => [point.lng, point.lat] as [number, number]);

	return (
		<>
			<MapRoute coordinates={coordinates} color={route.color} width={5} opacity={0.75} />
			{route.stops.map((stop) => {
				const next = nextStopIds.has(stop.id);

				return (
					<MapMarker
						key={`${stop.id}-${threeD ? "pin" : "dot"}-${next ? "next" : "stop"}`}
						longitude={stop.lng}
						latitude={stop.lat}
						pitchAlignment={threeD ? "map" : "auto"}
						rotationAlignment={threeD ? "map" : "auto"}
						className={cn(next ? "z-30" : "z-0", threeD && "preserve-3d")}
						onClick={() => onSelectStop(stop.id)}
					>
						<MarkerContent className={threeD ? "preserve-3d" : undefined}>
							{threeD ? (
								<StopPin selected={stop.id === selectedStopId} entering={entering} />
							) : (
								<StopDot selected={stop.id === selectedStopId} entering={entering} />
							)}
						</MarkerContent>
						<MarkerTooltip>
							{stop.stop_order}. {stop.name}
						</MarkerTooltip>
					</MapMarker>
				);
			})}
		</>
	);
}

function StopDot({ selected, entering }: { selected: boolean; entering: boolean }) {
	return (
		<div
			className={cn(
				entering && ENTER_ZOOM,
				selected
					? "size-5 rounded-full border-2 border-background bg-stop-active shadow-md ring-2 ring-stop-active/40"
					: "size-3 rounded-full border-2 border-background bg-stop shadow-sm",
			)}
		/>
	);
}

// A pin planted on the stop: a shadow on the road, a post made of two crossed
// walls so it has width from every bearing, and a ball that faces the viewer.
function StopPin({ selected, entering }: { selected: boolean; entering: boolean }) {
	const post = selected ? "h-5 w-1 bg-stop-active" : "h-4 w-[3px] bg-stop";

	return (
		<div className={cn("relative size-4 preserve-3d", entering && ENTER)}>
			<div
				className={cn(
					"absolute inset-0 rounded-full blur-xs",
					selected ? "bg-stop-active/40" : "bg-foreground/35",
				)}
			/>
			<div className={cn("absolute bottom-1/2 left-1/2 stand -translate-x-1/2", post)} />
			<div
				className={cn(
					"absolute bottom-1/2 left-1/2 stand-across -translate-x-1/2 brightness-75",
					post,
				)}
			/>
			<div
				className={cn(
					"absolute top-1/2 left-1/2 face-camera rounded-full shadow-md ring-2 ring-background",
					selected
						? "-mt-3 -ml-3 size-6 bg-stop-active ring-stop-active/40 [--lift:26px]"
						: "-mt-2 -ml-2 size-4 bg-stop [--lift:20px]",
				)}
			>
				<div className="absolute inset-[30%] rounded-full bg-background" />
				<div className="absolute top-[12%] left-[18%] size-[22%] rounded-full bg-background/50" />
			</div>
		</div>
	);
}

// A minibus lying on the road, built from CSS faces so it stands up when the
// map tilts and turns with the heading. The element's top edge is the front.
// On a wall rotated up from its edge, that edge is ground level and the
// opposite edge is the roof line.
function BusBody({ stale, entering }: { stale: boolean; entering: boolean }) {
	const body = "bg-eride-body";
	const glass = "bg-eride-glass";
	const skirt = "bg-eride-glass/80";

	return (
		<div
			className={cn(
				"relative h-12 w-5 preserve-3d",
				entering && ENTER,
				stale && "opacity-70 grayscale",
			)}
		>
			<div className="absolute -inset-1 rounded-xl bg-black/30 blur-xs" />
			<div className="absolute inset-x-0.5 inset-y-1 rounded-sm bg-black/80" />

			<Wheel side="left" className="top-2" />
			<Wheel side="left" className="bottom-2.5" />
			<Wheel side="right" className="top-2" />
			<Wheel side="right" className="bottom-2.5" />

			<div className="absolute inset-0 lift-wheels">
				<div
					className={cn(
						"absolute top-0 left-0 h-4 w-full face-front brightness-95 backface-hidden",
						body,
					)}
				>
					<div className={cn("absolute inset-x-0 top-0 h-0.5", skirt)} />
					<div className="absolute inset-x-0 top-0.5 h-[6px] bg-eride-lime" />
					<div className="absolute top-1 left-0.5 h-0.5 w-1 rounded-full bg-white" />
					<div className="absolute top-1 right-0.5 h-0.5 w-1 rounded-full bg-white" />
					<div className="absolute inset-x-2 top-1 h-0.5 bg-eride-green/70" />
					<div className={cn("absolute inset-x-px top-2 h-[7px] rounded-b-sm", glass)}>
						<div className="absolute inset-x-1 bottom-0.5 h-px bg-white/25" />
					</div>
				</div>

				<div
					className={cn(
						"absolute bottom-0 left-0 h-4 w-full face-back brightness-75 backface-hidden",
						"bg-eride-green",
					)}
				>
					<div className={cn("absolute inset-x-0 bottom-0 h-0.5", skirt)} />
					<div className="absolute bottom-1 left-0.5 h-0.5 w-1 rounded-full bg-destructive" />
					<div className="absolute right-0.5 bottom-1 h-0.5 w-1 rounded-full bg-destructive" />
					<div className="absolute inset-x-1.5 bottom-1 h-0.5 bg-eride-lime/80" />
					<div className={cn("absolute inset-x-1 top-px h-[7px] rounded-t-sm", glass)} />
				</div>

				<div
					className={cn(
						"absolute top-0 left-0 h-full w-4 face-left brightness-85 backface-hidden",
						body,
					)}
				>
					<Livery side="left" />
					<div className={cn("absolute inset-y-0 left-0 w-0.5", skirt)} />
					<Windows className="inset-y-1 right-0.5" />
				</div>

				<div
					className={cn(
						"absolute top-0 right-0 h-full w-4 face-right brightness-85 backface-hidden",
						body,
					)}
				>
					<Livery side="right" />
					<div className={cn("absolute inset-y-0 right-0 w-0.5", skirt)} />
					<Windows className="top-3.5 bottom-1 left-0.5" />
					<div
						className={cn(
							"absolute top-1 left-0.5 h-2.5 w-3 rounded-r-xs ring-1 ring-eride-body/70",
							glass,
						)}
					>
						<div className="absolute inset-y-px left-[5px] w-px bg-eride-body/50" />
					</div>
				</div>

				<div className={cn("absolute inset-0 face-top rounded-md ring-1 ring-eride-body", body)}>
					<div className={cn("absolute inset-x-1 top-0.5 h-1 rounded-t-sm", glass)} />
					<div className="absolute inset-x-1.5 top-[22%] h-1.5 rounded-xs bg-eride-steel ring-1 ring-black/15">
						<div className="absolute inset-x-0.5 top-0.5 h-px bg-black/20" />
					</div>
					<div className="absolute inset-x-1 bottom-1 h-4 rounded-sm bg-eride-green ring-1 ring-black/20">
						<div className="absolute inset-x-1 top-0.5 h-px rounded-full bg-eride-lime/70" />
						<div className="absolute inset-x-0.5 bottom-0.5 h-px bg-black/25" />
					</div>
				</div>
			</div>
		</div>
	);
}

// The green rear and lime sweep painted along a side wall. On a wall the roof
// is the inner edge, so the sweep sits toward the ground on each side.
function Livery({ side }: { side: "left" | "right" }) {
	const ground = side === "left" ? "left-0.5" : "right-0.5";

	return (
		<>
			<div className="absolute inset-x-0 bottom-0 h-[38%] bg-eride-green" />
			<div
				className={cn(
					"absolute bottom-[38%] h-2 w-[6px] bg-eride-lime",
					ground,
					side === "left" ? "rounded-tr-full" : "rounded-tl-full",
				)}
			/>
			<div className={cn("absolute top-1 bottom-[38%] w-px bg-eride-lime", ground)} />
		</>
	);
}

// A band of panes along a side wall, with thin body-colored pillars between.
function Windows({ className }: { className: string }) {
	return (
		<div className={cn("absolute flex w-[7px] flex-col gap-px bg-eride-body/60", className)}>
			<div className="flex-1 bg-eride-glass" />
			<div className="flex-1 bg-eride-glass" />
			<div className="flex-1 bg-eride-glass" />
			<div className="flex-1 bg-eride-glass" />
		</div>
	);
}

function Wheel({ side, className }: { side: "left" | "right"; className: string }) {
	return (
		<div
			className={cn(
				"absolute size-2 rounded-full bg-eride-glass",
				side === "left" ? "left-0.5 face-left" : "right-0.5 face-right",
				className,
			)}
		>
			<div className="absolute inset-[30%] rounded-full bg-eride-steel/80" />
		</div>
	);
}

function BusDisc({ stale, color, entering }: { stale: boolean; color: string; entering: boolean }) {
	return (
		<div
			className={cn(
				"grid size-9 place-items-center rounded-full shadow-lg ring-2 ring-background",
				entering && ENTER_ZOOM,
				stale ? "bg-muted text-muted-foreground" : "bg-(--bus-color) text-white",
			)}
			style={{ "--bus-color": color } as React.CSSProperties}
		>
			<Navigation2 className="size-5" />
		</div>
	);
}

function BusMarker({
	tracked,
	threeD,
	entering,
	color,
	onOpen,
}: {
	tracked: TrackedBus;
	threeD: boolean;
	entering: boolean;
	color: string;
	onOpen: (busId: number) => void;
}) {
	const { bus, position, heading, stale } = tracked;
	const side = useCardSide(heading - useMapBearing());

	return (
		<>
			<MapMarker
				longitude={position[0]}
				latitude={position[1]}
				rotation={heading}
				rotationAlignment="map"
				pitchAlignment="map"
				className="z-10 preserve-3d"
			>
				<MarkerContent className="preserve-3d">
					{threeD ? (
						<BusBody stale={stale} entering={entering} />
					) : (
						<BusDisc stale={stale} color={color} entering={entering} />
					)}
				</MarkerContent>
			</MapMarker>
			<MapMarker
				longitude={position[0]}
				latitude={position[1]}
				className="z-20"
				onClick={() => onOpen(bus.bus_id)}
			>
				<MarkerContent>
					<div className="relative size-0">
						<div
							className={cn(
								"absolute top-0 left-0 transition-transform duration-700 ease-in-out",
								side === "right" ? "beside-right" : "beside-left",
							)}
						>
							<BusCard tracked={tracked} color={color} entering={entering} />
						</div>
					</div>
				</MarkerContent>
			</MapMarker>
		</>
	);
}

// Keeps the card on the side the bus is driving away from, so it never sits
// over the road ahead. The dead band stops it flapping on a northbound bus.
function useCardSide(screenHeading: number): "left" | "right" {
	const east = Math.sin((screenHeading * Math.PI) / 180);
	const [side, setSide] = useState<"left" | "right">(east > 0 ? "left" : "right");

	if (side === "right" && east > 0.35) setSide("left");
	if (side === "left" && east < -0.35) setSide("right");

	return side;
}

// Rides beside the bus with what a rider wants at a glance.
function BusCard({
	tracked,
	color,
	entering,
}: {
	tracked: TrackedBus;
	color: string;
	entering: boolean;
}) {
	const { bus, nextStop, etaSeconds, stale } = tracked;

	return (
		<div
			className={cn(
				"flex w-56 cursor-pointer flex-col rounded-2xl px-3.5 py-2.5 text-xs text-foreground glass transition-all hover:brightness-105 active:scale-95",
				entering && "animate-in duration-500 zoom-in-95 fade-in",
			)}
			style={{ "--bus-color": color } as React.CSSProperties}
		>
			<div className="flex items-center gap-1.5">
				<span
					className={cn(
						"size-2.5 shrink-0 rounded-full",
						stale ? "bg-muted-foreground/50" : "bg-(--bus-color)",
					)}
				/>
				<span className="truncate text-sm font-semibold">{bus.bus_name}</span>
				<ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
			</div>
			<span className="text-muted-foreground">{busStatus(tracked)}</span>
			{nextStop ? (
				<div className="mt-1.5 flex flex-col">
					<span className="text-muted-foreground uppercase">Next stop</span>
					<span className="leading-snug font-medium">{nextStop.name}</span>
					<span className="text-sm font-semibold tabular-nums" suppressHydrationWarning>
						{arrivalLabel(etaSeconds, stale)}
					</span>
				</div>
			) : (
				<span className="mt-1.5 text-muted-foreground">Not on its route right now</span>
			)}
		</div>
	);
}

function busStatus({ stale, dwelling, speedMps }: TrackedBus): string {
	const kmh = Math.round(speedMps * 3.6);

	if (stale) return "No signal from the bus";
	if (dwelling) return "Stopped at a bus stop";
	if (kmh === 0) return "Stopped";

	return `Moving at ${kmh} km/h`;
}

type BusPanelProps = {
	tracked: TrackedBus | null;
	stopsAhead: StopArrival[];
	settling: boolean;
	now: number;
	color: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelectStop: (stopId: number) => void;
};

const CLOSE_BUTTON =
	"absolute top-3 right-3 z-10 grid size-8 place-items-center rounded-md text-white/80 transition-colors outline-none hover:bg-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70";

// Phones get a bottom sheet that can be pulled up, wider screens a side panel.
// Neither dims the map, so the buses keep moving in view while the rider reads.
function BusPanel(props: BusPanelProps) {
	const isMobile = useIsMobile();

	return isMobile ? <BusDrawer {...props} /> : <BusSheet {...props} />;
}

function BusSheet(props: BusPanelProps) {
	const { tracked, open, onOpenChange } = props;

	return (
		<Sheet open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
			<SheetContent
				side="left"
				showOverlay={false}
				showCloseButton={false}
				initialFocus={(openType) => openType === "keyboard"}
				className="w-full sm:max-w-sm"
			>
				{tracked ? (
					<>
						<SheetTitle className="sr-only">{tracked.bus.bus_name}</SheetTitle>
						<SheetDescription className="sr-only">{tracked.bus.route_name}</SheetDescription>
						<BusHero
							tracked={tracked}
							now={props.now}
							color={props.color}
							handle={false}
							close={
								<SheetClose
									aria-label="Close"
									render={<button type="button" className={CLOSE_BUTTON} />}
								>
									<X className="size-4" />
								</SheetClose>
							}
						/>
						<BusDetails {...props} tracked={tracked} />
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function BusDrawer(props: BusPanelProps) {
	const { tracked, open, onOpenChange } = props;

	return (
		<Drawer open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
			<DrawerContent
				className="[--drawer-height:55dvh]"
				header={
					tracked ? (
						<BusHero
							tracked={tracked}
							now={props.now}
							color={props.color}
							handle
							close={
								<DrawerClose
									aria-label="Close"
									render={
										<button
											type="button"
											className={cn(CLOSE_BUTTON, "hidden pointer-fine:grid")}
										/>
									}
								>
									<X className="size-4" />
								</DrawerClose>
							}
						/>
					) : null
				}
			>
				{tracked ? (
					<>
						<DrawerTitle className="sr-only">{tracked.bus.bus_name}</DrawerTitle>
						<DrawerDescription className="sr-only">{tracked.bus.route_name}</DrawerDescription>
						<BusDetails {...props} tracked={tracked} />
					</>
				) : null}
			</DrawerContent>
		</Drawer>
	);
}

function BusDetails({
	tracked,
	stopsAhead,
	settling,
	now,
	color,
	onSelectStop,
}: Omit<BusPanelProps, "tracked" | "open" | "onOpenChange"> & { tracked: TrackedBus }) {
	const { map } = useMap();

	const flyTo = (target: LngLat) => {
		map?.easeTo({ center: target, zoom: Math.max(map.getZoom(), 16), duration: 600 });
	};

	return (
		<>
			<div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pt-1 pb-5">
				{settling ? (
					<StopsAheadSkeleton />
				) : stopsAhead.length > 0 ? (
					<section className="flex flex-col gap-3">
						<div className="flex items-baseline justify-between">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase">
								Where it goes next
							</h3>
							<span className="text-xs text-muted-foreground">Tap a stop to see it</span>
						</div>
						<ol className="flex flex-col">
							<li className="flex gap-3">
								<div className="flex w-6 flex-col items-center">
									<span
										className="mt-1.5 grid size-6 shrink-0 place-items-center rounded-full bg-(--bus-color) text-white ring-4 ring-(--bus-color)/20"
										style={{ "--bus-color": color } as React.CSSProperties}
									>
										<Bus className="size-3.5" />
									</span>
									<span
										className="w-0.5 flex-1 bg-(--bus-color)"
										style={{ "--bus-color": color } as React.CSSProperties}
									/>
								</div>
								<div className="flex flex-col px-2 pt-1.5 pb-4">
									<span className="font-semibold">{tracked.bus.bus_name} is here</span>
									<span className="text-xs text-muted-foreground">
										{tracked.metersToNextStop !== null
											? `${formatDistance(tracked.metersToNextStop)} to the next stop`
											: busStatus(tracked)}
									</span>
								</div>
							</li>
							{stopsAhead.map((arrival, index) => {
								const last = index === stopsAhead.length - 1;
								const next = index === 0;

								return (
									<li key={arrival.stop.id} className="flex gap-3">
										<div className="flex w-6 flex-col items-center">
											<span
												className={cn(
													"mt-3 shrink-0 rounded-full border-2 border-background",
													next
														? "size-4 bg-stop-active ring-2 ring-stop-active/40"
														: "size-3 bg-stop",
												)}
											/>
											{last ? null : <span className="w-0.5 flex-1 bg-muted-foreground/25" />}
										</div>
										<button
											type="button"
											onClick={() => {
												onSelectStop(arrival.stop.id);
												flyTo([arrival.stop.lng, arrival.stop.lat]);
											}}
											className={cn(
												"mb-1 flex flex-1 items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent",
												next && "bg-stop-active/10",
											)}
										>
											<span className="flex min-w-0 flex-col">
												<span className={cn("truncate", next ? "font-semibold" : "font-medium")}>
													{arrival.stop.name}
												</span>
												<span className="text-xs text-muted-foreground">
													{next ? "Next stop · " : ""}
													{formatDistance(arrival.metersAhead)} away
												</span>
											</span>
											<span className="flex shrink-0 flex-col items-end">
												<span
													className={cn(
														"tabular-nums",
														next ? "text-base font-bold text-stop-active" : "font-semibold",
													)}
													suppressHydrationWarning
												>
													{arrivalLabel(arrival.etaSeconds, arrival.stale)}
												</span>
												{arrival.etaSeconds !== null && !arrival.stale ? (
													<span
														className="text-xs text-muted-foreground tabular-nums"
														suppressHydrationWarning
													>
														{arrivalClock(now, arrival.etaSeconds)}
													</span>
												) : null}
											</span>
										</button>
									</li>
								);
							})}
						</ol>
					</section>
				) : (
					<p className="text-muted-foreground">
						This bus is off its route right now, so there is no stop list.
					</p>
				)}
				<section className="flex flex-col gap-3">
					<h3 className="text-xs font-semibold text-muted-foreground uppercase">About this bus</h3>
					<StatTile icon={<Gauge />} label="Speed">
						{Math.round(tracked.speedMps * 3.6)} km/h
					</StatTile>
					{tracked.bus.driver_name ? (
						<p className="text-xs text-muted-foreground">Driver: {tracked.bus.driver_name}</p>
					) : null}
				</section>
			</div>
			<div className="flex shrink-0 flex-col p-4">
				<Button size="lg" onClick={() => flyTo(tracked.position)}>
					<LocateFixed />
					Show me this bus
				</Button>
			</div>
		</>
	);
}

// The colored top of the panel: who the bus is, whether it is live, and the
// one thing a rider wants to know, where it stops next and when.
function BusHero({
	tracked,
	now,
	color,
	close,
	handle,
}: {
	tracked: TrackedBus;
	now: number;
	color: string;
	close?: React.ReactNode;
	handle: boolean;
}) {
	const { bus, nextStop, etaSeconds, stale } = tracked;

	return (
		<div
			className={cn(
				"relative shrink-0 overflow-hidden bg-(--bus-color) px-5 pb-6 text-white select-none",
				handle ? "cursor-grab rounded-t-2xl pt-3 active:cursor-grabbing" : "pt-5",
			)}
			style={{ "--bus-color": color } as React.CSSProperties}
		>
			<div className="absolute -top-12 -right-8 size-44 rounded-full bg-white/10" />
			<div className="absolute right-20 -bottom-16 size-36 rounded-full bg-white/10" />
			{close}
			{handle ? (
				<div className="relative mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/50" />
			) : null}
			<div className="relative flex items-center gap-3">
				<div className="flex min-w-0 flex-col">
					<span className="truncate text-xl leading-tight font-bold">{bus.bus_name}</span>
					<span className="truncate text-sm text-white/80">{bus.route_name}</span>
				</div>
			</div>
			{nextStop ? (
				<div className="relative mt-5 flex flex-col">
					<span className="text-xs font-medium text-white/70 uppercase">Next stop</span>
					<span className="text-2xl leading-tight font-bold">{nextStop.name}</span>
					<span className="mt-1 text-lg font-semibold" suppressHydrationWarning>
						{arrivalLabel(etaSeconds, stale)}
						{etaSeconds !== null && !stale ? (
							<span className="font-normal text-white/80"> · {arrivalClock(now, etaSeconds)}</span>
						) : null}
					</span>
				</div>
			) : (
				<p className="relative mt-5 text-lg font-semibold">Off its route right now</p>
			)}
		</div>
	);
}

function StatTile({
	icon,
	label,
	children,
}: {
	icon: React.ReactNode;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 rounded-2xl bg-foreground/5 p-3">
			<span className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5 text-muted-foreground [&>svg]:size-4">
				{icon}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="text-xs text-muted-foreground">{label}</span>
				<span className="truncate font-semibold">{children}</span>
			</span>
		</div>
	);
}

function arrivalLabel(etaSeconds: number | null, stale: boolean): string {
	if (stale || etaSeconds === null) return "Unknown";
	if (etaSeconds < 45) return "Arriving now";

	const minutes = Math.max(1, Math.round(etaSeconds / 60));

	return `in ${minutes} min`;
}

function StopPanel({
	stop,
	arrivals,
	settling,
	now,
	userPosition,
	onLocate,
	onClose,
}: {
	stop: BusStop;
	arrivals: StopArrival[];
	settling: boolean;
	now: number;
	userPosition: LngLat | null;
	onLocate: (position: LngLat) => void;
	onClose: () => void;
}) {
	const [locating, setLocating] = useState(false);
	const walkSeconds = userPosition
		? (haversineMeters(userPosition, [stop.lng, stop.lat]) * WALK_DETOUR) / WALK_MPS
		: null;

	const locate = () => {
		if (!("geolocation" in navigator)) return;
		setLocating(true);
		navigator.geolocation.getCurrentPosition(
			(position) => {
				onLocate([position.coords.longitude, position.coords.latitude]);
				setLocating(false);
			},
			() => setLocating(false),
			{ timeout: 10_000 },
		);
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-col">
					<span className="text-xs text-muted-foreground">Stop {stop.stop_order}</span>
					<span className="truncate font-medium">{stop.name}</span>
				</div>
				<Button variant="ghost" size="icon-sm" aria-label="Close stop" onClick={onClose}>
					<X />
				</Button>
			</div>
			{settling ? (
				<ArrivalsSkeleton />
			) : arrivals.length === 0 ? (
				<span className="text-xs text-muted-foreground">No bus is heading here right now.</span>
			) : (
				<ol className="flex flex-col gap-2">
					{arrivals.map((arrival, index) => (
						<ArrivalRow
							key={arrival.bus.bus_id}
							arrival={arrival}
							previous={index > 0 ? arrivals[index - 1] : null}
							now={now}
							walkSeconds={walkSeconds}
						/>
					))}
				</ol>
			)}
			{walkSeconds === null ? (
				<Button variant="secondary" size="sm" onClick={locate} disabled={locating}>
					<LocateFixed data-icon="inline-start" />
					{locating ? "Finding you" : "Add my walking time"}
				</Button>
			) : (
				<span className="text-xs text-muted-foreground" suppressHydrationWarning>
					About {formatMinutes(walkSeconds)} walk from you. Leave times allow for it.
				</span>
			)}
		</div>
	);
}

function ArrivalRow({
	arrival,
	previous,
	now,
	walkSeconds,
}: {
	arrival: StopArrival;
	previous: StopArrival | null;
	now: number;
	walkSeconds: number | null;
}) {
	const { bus, etaSeconds, metersAhead, stale } = arrival;
	const headway =
		previous?.etaSeconds !== null && previous?.etaSeconds !== undefined && etaSeconds !== null
			? etaSeconds - previous.etaSeconds
			: null;

	return (
		<li className="flex flex-col gap-0.5 text-xs">
			<div className="flex items-center justify-between gap-2">
				<span className="truncate font-medium">{bus.bus_name}</span>
				<span className="shrink-0 tabular-nums" suppressHydrationWarning>
					{etaSeconds !== null ? formatEta(etaSeconds, stale) : "—"}
					{etaSeconds !== null && !stale ? ` · ${arrivalClock(now, etaSeconds)}` : null}
				</span>
			</div>
			<div className="flex items-center justify-between gap-2 text-muted-foreground">
				<span>
					{formatDistance(metersAhead)} away
					{headway !== null ? ` · ${formatMinutes(headway)} after previous` : null}
				</span>
				{walkSeconds !== null && etaSeconds !== null && !stale ? (
					<span className="shrink-0 font-medium tabular-nums">
						{formatLeave(etaSeconds - walkSeconds)}
					</span>
				) : null}
			</div>
		</li>
	);
}

function arrivalClock(now: number, etaSeconds: number): string {
	return new Date(now + etaSeconds * 1000).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatMinutes(seconds: number): string {
	const minutes = Math.round(seconds / 60);

	return minutes <= 1 ? "1 min" : `${minutes} min`;
}

// How long before the bus arrives a person can still set off and make it.
function formatLeave(headroomSeconds: number): string {
	if (headroomSeconds < -30) return "Too late for this one";
	if (headroomSeconds < 60) return "Leave now";

	return `Leave in ${formatMinutes(headroomSeconds)}`;
}

function formatEta(seconds: number, stale: boolean): string {
	if (stale) return "no signal";
	if (seconds < 45) return "arriving";

	const minutes = Math.round(seconds / 60);

	return minutes <= 1 ? "1 min" : `${minutes} min`;
}

function formatDistance(meters: number): string {
	if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;

	return `${(meters / 1000).toFixed(1)} km`;
}
