import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bus, BusFront, ChevronRight, LocateFixed, Navigation2, X } from "lucide-react";
import {
	memo,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { TextMorph } from "torph/react";

import { FollowBus } from "@/components/follow-bus";
import { MapFirstDraw } from "@/components/map-first-draw";
import { PanelGlass } from "@/components/panel-glass";
import { RoadAhead } from "@/components/road-ahead";
import { ArrivalsSkeleton, StopsAheadSkeleton } from "@/components/live-map-skeleton";
import { Map3dToggle } from "@/components/map-3d-toggle";
import { MapCameraVars } from "@/components/map-camera-vars";
import { MapMissingImages } from "@/components/map-missing-images";
import { MapSettings } from "@/components/map-settings";
import { MapViewMemory, savedView, shows, type SavedView } from "@/components/map-view-memory";
import { SpeedGauge } from "@/components/speed-gauge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
	type CarouselApi,
} from "@/components/ui/carousel";
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
import type { BusTracker, StopArrival, TrackedBus } from "@/lib/bus-tracker";
import { haversineMeters, type LngLat } from "@/lib/geo";
import type { Map as MapLibreMap } from "maplibre-gl";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { liveMapQueryOptions, savedRoutesQueryOptions } from "@/lib/live-map";
import { MAP_STYLE_PAIRS, useLiquidGlass, usePanelTheme, useSettings } from "@/lib/settings";
import type { BusRoute, BusStop, LiveBus, LiveMap } from "@/server/live-map";

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
// How close an opened stop card may sit to the edge of the map.
const CARD_MARGIN = 12;
// Lifts a stop's hover label above the 3D pin's ball instead of over it.
const STOP_PIN_TOOLTIP_OFFSET = 32;
// Matches the stop card's closing transition in styles.css.
const STOP_CARD_CLOSE_MS = 300;
// The stop card's size, with room for a later bus, and how far it sits from its stop.
const STOP_CARD_WIDTH = 288;
const STOP_CARD_HEIGHT = 170;
const STOP_CARD_GAP = 16;
const STOP_CARD_GAP_3D = 40;
// How far the bus moves before its road to the stop and the gap in the route
// line are redrawn. Each redraw re-slices the whole line in MapLibre's worker.
const ROAD_STEP_M = 5;
// How often a bus card's speed may change.
const SPEED_LABEL_MS = 1000;
// A bus this close to the stop that is suddenly far from it, or gone, has passed it.
const PASS_NEAR_M = 200;
const PASS_JUMP_M = 500;
// Phones at 3x draw more than twice the pixels of 2x for little visible gain.
const MAX_PIXEL_RATIO =
	typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
const ENTER = "animate-in fade-in duration-500";
const ENTER_ZOOM = "animate-in fade-in zoom-in-50 duration-500";

type StartView = { center: LngLat; zoom: number; bearing: number };

const WHOLE_ROUTE: StartView = { center: BELIZE_CITY, zoom: DEFAULT_ZOOM, bearing: 0 };

/**
 * Where the map opens. The last visit's view comes back unless the buses we
 * know of are all outside it. With no buses to check against, it is trusted.
 */
function chooseStartView(
	view: ViewSearch,
	last: SavedView | null,
	feed: LiveMap | undefined,
): StartView {
	if (view.lng !== undefined && view.lat !== undefined) {
		return { center: [view.lng, view.lat], zoom: view.zoom ?? DEFAULT_ZOOM, bearing: 0 };
	}
	if (!last) return WHOLE_ROUTE;
	if (!feed?.buses.length) return last;

	return feed.buses.some((bus) => shows(last, [bus.lng, bus.lat])) ? last : WHOLE_ROUTE;
}

const noSubscribe = () => () => {};

function LiveMapPage() {
	const panelTheme = usePanelTheme();
	const { data, dataUpdatedAt, error } = useQuery(liveMapQueryOptions());
	const { data: savedRoutes } = useQuery(savedRoutesQueryOptions());
	const view = Route.useSearch();
	const [lastView] = useState(savedView);
	// The saved view lives in the browser, so the server leaves the map out.
	const hydrated = useSyncExternalStore(
		noSubscribe,
		() => true,
		() => false,
	);
	// Picked once, before the map exists, so it opens in place instead of jumping.
	const [startView, setStartView] = useState<StartView | null>(null);
	const choice = hydrated && !startView ? chooseStartView(view, lastView, data) : null;
	if (choice) setStartView(choice);
	// The loader is solid until the map, route and stops have all drawn, so they
	// appear together, then see-through until the buses arrive.
	const [mapShown, setMapShown] = useState(false);
	const feedShown = mapShown && (data !== undefined || error !== null);
	const routes = data?.routes ?? savedRoutes ?? [];
	const { tracks, tracker, now } = useBusTracks(data, dataUpdatedAt);
	// Until the first animation frame, show the buses where the server put them.
	const parked = tracks.length > 0 ? tracks : (data?.buses ?? []).map(asParked);
	// Behind the loader the buses would visibly hop from the server's spot onto the route.
	const buses = now === 0 ? [] : parked;
	const nextStopKey = buses
		.flatMap((bus) => (bus.nextStop ? [bus.nextStop.id] : []))
		.toSorted((a, b) => a - b)
		.join(",");
	// Rebuilt only when the set changes, so the route lines can skip animation ticks.
	const nextStopIds = useMemo(
		() => new Set(nextStopKey ? nextStopKey.split(",").map(Number) : []),
		[nextStopKey],
	);
	const [selectedStopId, setSelectedStopId] = useState<number | null>(view.stop ?? null);
	// Which of the stop's coming buses its card is showing, kept with the stop
	// it belongs to so it never carries over to another one.
	const [stopCardBus, setStopCardBus] = useState<{ stopId: number; busId: number | null } | null>(
		null,
	);
	const stopCardBusId = stopCardBus?.stopId === selectedStopId ? stopCardBus.busId : null;
	const [threeD, setThreeD] = useState((view.pitch ?? 0) > 0);
	const [userPosition, setUserPosition] = useState<LngLat | null>(null);
	const settings = useSettings();
	const mapStyles = MAP_STYLE_PAIRS[settings.mapStyle];
	const [selectedBusId, setSelectedBusId] = useState<number | null>(null);
	const [busSheetOpen, setBusSheetOpen] = useState(false);
	// Bumped on every request to follow a bus, so asking again flies there again.
	const [followRequest, setFollowRequest] = useState<number | null>(null);
	const selectedStop = findStop(routes, selectedStopId);
	// One card per stop opened. Picking another stop closes the old card where
	// it stands while the new one opens, as two separate cards.
	const [stopCards, setStopCards] = useState<{ key: number; stopId: number | null }[]>([]);
	const openCard = stopCards.at(-1);
	// A bus panel takes over from the stop card; the stop stays chosen and shows in its list.
	const cardStopId = busSheetOpen ? null : selectedStopId;
	if (cardStopId !== (openCard?.stopId ?? null)) {
		setStopCards((cards) => [
			...cards.map((card) => ({ ...card, stopId: null })),
			...(cardStopId === null ? [] : [{ key: (cards.at(-1)?.key ?? 0) + 1, stopId: cardStopId }]),
		]);
	}
	const selectedBus = buses.find((bus) => bus.bus.bus_id === selectedBusId) ?? null;
	const stopsAhead =
		selectedBus && busSheetOpen && now > 0 ? tracker.stopsAheadOf(selectedBus.bus.bus_id, now) : [];
	const arrivals = useMemo(
		() => (selectedStop && now > 0 ? tracker.arrivalsAt(selectedStop.id, now) : []),
		[selectedStop, now, tracker],
	);
	// One bus gets its road drawn, the one the stop card is showing, else the
	// soonest; a bus a full loop away would cover the route.
	const nextArrival =
		arrivals.find((arrival) => !arrival.stale && arrival.bus.bus_id === stopCardBusId) ??
		arrivals.find((arrival) => !arrival.stale) ??
		null;
	// With a bus panel open, the road drawn is that bus's to the chosen stop.
	const panelArrival =
		busSheetOpen && selectedBus
			? (arrivals.find(
					(arrival) => !arrival.stale && arrival.bus.bus_id === selectedBus.bus.bus_id,
				) ?? null)
			: null;
	const roadArrival = cardStopId === null ? panelArrival : nextArrival;
	// Only cut out while dots fill the gap: the stop card's, or the bus panel's.
	const routeGap = useHeldUntil(roadStep(roadArrival), roadArrival);
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
	const followBus = useCallback(() => setFollowRequest((request) => (request ?? 0) + 1), []);
	const unfollowBus = useCallback(() => setFollowRequest(null), []);
	const openBus = useCallback(
		(busId: number) => {
			haptic("light");
			setSelectedBusId(busId);
			setBusSheetOpen(true);
			followBus();
		},
		[followBus],
	);
	// Once the card's bus passes the stop, the card moves on to the soonest
	// other bus, or closes when no other is coming.
	const cardArrival = cardStopId === null ? null : nextArrival;
	const lastCardArrival = useRef<{ stopId: number; busId: number; meters: number } | null>(null);
	useEffect(() => {
		const seen = lastCardArrival.current;
		lastCardArrival.current =
			cardStopId !== null && cardArrival
				? { stopId: cardStopId, busId: cardArrival.bus.bus_id, meters: cardArrival.metersAhead }
				: null;
		if (!seen || seen.stopId !== cardStopId || seen.meters > PASS_NEAR_M) return;

		const again = arrivals.find((arrival) => arrival.bus.bus_id === seen.busId);
		if (again && again.metersAhead < seen.meters + PASS_JUMP_M) return;

		if (arrivals.some((arrival) => !arrival.stale && arrival.bus.bus_id !== seen.busId)) {
			setStopCardBus({ stopId: seen.stopId, busId: null });
		} else {
			setSelectedStopId(null);
		}
	}, [arrivals, cardArrival, cardStopId]);
	const changeBusSheet = useCallback((open: boolean) => {
		setBusSheetOpen(open);
		if (!open) setFollowRequest(null);
	}, []);
	// The stop card and the bus sheet would both cover the map, so one gives way.
	const pickStop = useCallback(
		(stopId: number) => {
			haptic("light");
			setSelectedStopId(stopId);
			changeBusSheet(false);
		},
		[changeBusSheet],
	);

	return (
		<div className="relative h-dvh w-full" data-map-style={settings.mapStyle}>
			{startView ? (
				<Map
					center={startView.center}
					zoom={startView.zoom}
					bearing={startView.bearing}
					// The page's loader covers it. The map's own sits under the glass bus cards, and
					// removing it makes them blink as Chrome redraws their blur.
					loader={false}
					pitch={view.pitch ?? 0}
					styles={mapStyles}
					attributionControl={false}
					pixelRatio={MAX_PIXEL_RATIO}
					overlay={
						<div className={cn(panelTheme, "absolute top-3 right-3 z-40 flex flex-col gap-2")}>
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
					<MapViewMemory />
					<MapMissingImages />
					{routes.map((route) => (
						<RouteLine
							key={route.id}
							route={route}
							remainingLine={
								routeGap && routeGap.bus.route_id === route.id ? routeGap.routeRest : null
							}
							selectedStopId={selectedStopId}
							nextStopIds={nextStopIds}
							onSelectStop={pickStop}
							threeD={threeD}
							entering={entering}
						/>
					))}
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
					{busSheetOpen && routeGap && routeGap.path.length > 1 ? (
						<RoadAhead path={routeGap.path} color={routeGap.bus.route_color} visible />
					) : null}
					<BusPanel
						tracked={selectedBus}
						stopsAhead={stopsAhead}
						settling={settling}
						now={now}
						color={
							selectedBus ? routeColor(routes, selectedBus.bus.route_id) : FALLBACK_ROUTE_COLOR
						}
						open={busSheetOpen && selectedBus !== null}
						onOpenChange={changeBusSheet}
						onSelectStop={setSelectedStopId}
						onUnfollow={unfollowBus}
						selectedStopId={selectedStopId}
					/>
					<MapFirstDraw
						ready={now > 0 && (routes.length > 0 || error !== null)}
						onDrawn={() => setMapShown(true)}
					/>
					{stopCards.map((card) => (
						<StopCard
							key={card.key}
							stop={card.stopId === null ? null : selectedStop}
							roadBusId={stopCardBusId}
							threeD={threeD}
							tracker={tracker}
							settling={settling}
							now={now}
							userPosition={userPosition}
							onLocate={setUserPosition}
							onShowBus={(busId) =>
								selectedStopId !== null && setStopCardBus({ stopId: selectedStopId, busId })
							}
							onClose={() => {
								haptic("selection");
								setSelectedStopId(null);
							}}
							onClosed={() =>
								setStopCards((cards) => cards.filter((other) => other.key !== card.key))
							}
						/>
					))}
					<FollowBus
						position={selectedBus?.position ?? null}
						request={busSheetOpen ? followRequest : null}
						onRelease={unfollowBus}
					/>
				</Map>
			) : null}
			<div
				aria-hidden={feedShown}
				className={cn(
					// Kept on its own layer: when it drops off at the end of the fade, Chrome redraws the
					// glass cards under it and they flash.
					"absolute inset-0 z-50 flex transform-gpu items-center justify-center transition-opacity duration-1000 ease-out will-change-[opacity]",
					feedShown ? "opacity-0" : "opacity-100",
					// Holds the map still, drags and wheel included, until the overlay is on its way out.
					feedShown ? "pointer-events-none" : "touch-none",
				)}
			>
				{/* Solid until the map has drawn, then see-through. Two layers that only fade
				    their opacity, which the GPU does without repainting the screen. */}
				<div className="absolute inset-0 bg-background/60" />
				<div
					className={cn(
						"absolute inset-0 bg-background transition-opacity duration-1000 ease-out will-change-[opacity]",
						mapShown ? "opacity-0" : "opacity-100",
					)}
				/>
				<div className="relative flex loading-dots gap-1.5">
					<span className="size-2 rounded-full bg-muted-foreground" />
					<span className="size-2 rounded-full bg-muted-foreground" />
					<span className="size-2 rounded-full bg-muted-foreground" />
				</div>
			</div>
			{error !== null ? (
				// Placed by a wrapper: glisse's glass sets its own position.
				<div className="absolute top-3 left-3">
					<PanelGlass className="rounded-full px-3 py-1.5 text-xs font-semibold text-destructive">
						Feed offline
					</PanelGlass>
				</div>
			) : null}
		</div>
	);
}

// Lets a fast-changing label settle: a new value shows at most once per
// `intervalMs`, so a rolling number finishes its roll before the next one.
function useSteadyText(value: string, intervalMs: number): string {
	const [shown, setShown] = useState(value);
	// Reads the latest value when it fires; setting the same text again is a no-op.
	const settle = useEffectEvent(() => setShown(value));

	useEffect(() => {
		const timer = setInterval(settle, intervalMs);

		return () => clearInterval(timer);
	}, [intervalMs]);

	return shown;
}

// Keeps returning the first value seen for a key until the key changes, so
// heavy map data is rebuilt only when it has changed enough to matter.
function useHeldUntil<T>(key: string, value: T): T {
	const [held, setHeld] = useState({ key, value });
	if (held.key === key) return held.value;

	setHeld({ key, value });

	return value;
}

// The road ahead moves on in steps this long, not every animation frame.
function roadStep(arrival: StopArrival | null | undefined): string {
	return arrival ? `${arrival.bus.bus_id}:${Math.round(arrival.metersAhead / ROAD_STEP_M)}` : "";
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
const RouteLine = memo(function RouteLineView({
	route,
	remainingLine,
	selectedStopId,
	nextStopIds,
	onSelectStop,
	threeD,
	entering,
}: {
	route: BusRoute;
	/** The line with the road ahead cut out, since that stretch is drawn as dots. */
	remainingLine: LngLat[][] | null;
	selectedStopId: number | null;
	nextStopIds: Set<number>;
	onSelectStop: (stopId: number) => void;
	threeD: boolean;
	entering: boolean;
}) {
	const coordinates = useStableCoordinates(route.geometry);
	const pieces = remainingLine ?? [coordinates];

	return (
		<>
			{/* Keyed by position so the first piece keeps its layer as the road ahead comes and goes. */}
			{pieces.map((piece, index) => (
				<MapRoute key={index} coordinates={piece} color={route.color} width={5} opacity={0.75} />
			))}
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
						{stop.id === selectedStopId ? null : (
							<MarkerTooltip offset={threeD ? STOP_PIN_TOOLTIP_OFFSET : undefined}>
								{stop.stop_order}. {stop.name}
							</MarkerTooltip>
						)}
					</MapMarker>
				);
			})}
		</>
	);
});

// The feed sends fresh route objects on every poll. Handing the map the same
// array while the line is unchanged spares it a full geometry upload.
function useStableCoordinates(points: { lng: number; lat: number }[]): [number, number][] {
	const [stable, setStable] = useState(() => toPairs(points));
	const same =
		stable.length === points.length &&
		points.every((point, i) => stable[i][0] === point.lng && stable[i][1] === point.lat);

	if (same) return stable;

	const next = toPairs(points);
	setStable(next);

	return next;
}

function toPairs(points: { lng: number; lat: number }[]): [number, number][] {
	return points.map((point) => [point.lng, point.lat]);
}

// The dots are too small for a fingertip, so an invisible ring around each
// one takes the tap as well.
function StopDot({ selected, entering }: { selected: boolean; entering: boolean }) {
	return (
		<div
			className={cn(
				"relative transition-select before:absolute before:-inset-4 before:rounded-full",
				entering && ENTER_ZOOM,
				selected
					? "size-6 rounded-full border-4 border-background bg-stop shadow-lg ring-4 ring-stop/35"
					: "size-3 rounded-full border-2 border-background bg-stop shadow-sm",
			)}
		/>
	);
}

// A pin planted on the stop: a shadow on the road, a post made of two crossed
// walls so it has width from every bearing, and a ball that faces the viewer.
function StopPin({ selected, entering }: { selected: boolean; entering: boolean }) {
	const post = selected ? "h-5 w-1 bg-stop" : "h-4 w-[3px] bg-stop";

	return (
		<div className={cn("relative size-4 preserve-3d", entering && ENTER)}>
			<div
				className={cn(
					"absolute inset-0 rounded-full blur-xs transition-select",
					selected ? "bg-stop/50" : "bg-foreground/35",
				)}
			/>
			<div
				className={cn(
					"absolute bottom-1/2 left-1/2 stand -translate-x-1/2 transition-select",
					post,
				)}
			/>
			<div
				className={cn(
					"absolute bottom-1/2 left-1/2 stand-across -translate-x-1/2 brightness-75 transition-select",
					post,
				)}
			/>
			<div
				className={cn(
					"absolute top-1/2 left-1/2 face-camera rounded-full shadow-md ring-2 ring-background transition-select before:absolute before:-inset-3 before:rounded-full",
					selected
						? "-mt-3 -ml-3 size-6 bg-stop ring-4 ring-stop/35 [--lift:26px]"
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
				// Whole-pixel steps read as a shudder on a bus that moves every frame.
				subpixelPositioning
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
				subpixelPositioning
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

// Rides beside the bus as a small pill with its name and speed. Hovering
// springs it open to the next stop and the arrival time.
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
	// The tracker refines the speed every frame; once a second is plenty to read.
	const speed = useSteadyText(speedLabel(tracked), SPEED_LABEL_MS);

	return (
		<PanelGlass
			className={cn(
				// Its layout is its own, so the hover spring reflows only the card, not the page.
				"group flex w-max cursor-pointer flex-col rounded-2xl px-3 py-1.5 text-xs text-foreground transition-morph delay-75 spring-reverse contain-layout hover:rounded-3xl hover:px-3.5 hover:py-2.5 hover:brightness-105 hover:delay-0 hover:spring active:scale-95",
				// The hover delay also delays this fade, so hold the faded-out start until it runs.
				entering && "animate-in duration-500 fill-mode-backwards zoom-in-95 fade-in",
			)}
			style={{ "--bus-color": color } as React.CSSProperties}
		>
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"size-2.5 shrink-0 rounded-full",
						stale ? "bg-muted-foreground/50" : "bg-(--bus-color)",
					)}
				/>
				<div className="flex min-w-0 flex-col leading-tight">
					<div className="flex items-baseline">
						<span className="truncate text-sm font-semibold">{bus.bus_name}</span>
						<span className="grid grid-cols-[0fr] transition-unfold delay-75 spring-reverse group-hover:grid-cols-[1fr] group-hover:delay-0 group-hover:spring">
							<span
								aria-hidden
								className="min-w-0 overflow-hidden pl-1.5 whitespace-nowrap text-muted-foreground tabular-nums opacity-0 transition-reveal delay-75 spring-reverse group-hover:opacity-100 group-hover:delay-0 group-hover:spring"
							>
								<TextMorph>{speed}</TextMorph>
							</span>
						</span>
					</div>
					<span className="grid grid-rows-[1fr] transition-unfold delay-75 spring-reverse group-hover:grid-rows-[0fr] group-hover:delay-0 group-hover:spring">
						<span className="min-h-0 overflow-hidden text-muted-foreground tabular-nums transition-reveal delay-75 spring-reverse group-hover:opacity-0 group-hover:delay-0 group-hover:spring">
							<TextMorph>{speed}</TextMorph>
						</span>
					</span>
				</div>
				<ChevronRight className="ml-auto h-3.5 w-0 shrink-0 text-muted-foreground opacity-0 transition-reveal delay-75 spring-reverse group-hover:w-3.5 group-hover:opacity-100 group-hover:delay-0 group-hover:spring" />
			</div>
			<div className="grid grid-cols-[0fr] grid-rows-[0fr] transition-unfold delay-75 spring-reverse group-hover:grid-cols-[1fr] group-hover:grid-rows-[1fr] group-hover:delay-0 group-hover:spring">
				<div className="min-h-0 min-w-0 overflow-hidden">
					<div className="flex w-48 scale-95 flex-col pt-1.5 opacity-0 blur-sm transition-reveal spring-reverse group-hover:scale-100 group-hover:opacity-100 group-hover:blur-none group-hover:delay-75 group-hover:spring">
						{nextStop ? (
							<>
								<span className="text-muted-foreground uppercase">Next stop</span>
								<span className="leading-snug font-medium">{nextStop.name}</span>
								<span className="text-sm font-semibold tabular-nums" suppressHydrationWarning>
									<TextMorph>{arrivalLabel(etaSeconds, stale)}</TextMorph>
								</span>
							</>
						) : (
							<span className="text-muted-foreground">Not on its route right now</span>
						)}
					</div>
				</div>
			</div>
		</PanelGlass>
	);
}

function speedLabel({ stale, dwelling, speedMps }: TrackedBus): string {
	const kmh = Math.round(speedMps * 3.6);

	if (stale) return "No signal";
	if (dwelling) return "At a stop";
	if (kmh === 0) return "Stopped";

	return `${kmh} km/h`;
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
	onUnfollow: () => void;
	/** The stop the rider picked, picked out in the list of stops ahead. */
	selectedStopId: number | null;
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
	const panelTheme = usePanelTheme();
	const liquidGlass = useLiquidGlass();
	const { tracked, open, onOpenChange } = props;

	return (
		<Sheet open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
			<SheetContent
				liquidGlass={liquidGlass ? panelTheme : undefined}
				side="left"
				showOverlay={false}
				showCloseButton={false}
				initialFocus={(openType) => openType === "keyboard"}
				className={panelTheme === "dark" ? "dark w-full sm:max-w-sm" : "light w-full sm:max-w-sm"}
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
	const panelTheme = usePanelTheme();
	const liquidGlass = useLiquidGlass();
	const { tracked, open, onOpenChange } = props;

	return (
		<Drawer open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
			<DrawerContent
				liquidGlass={liquidGlass ? panelTheme : undefined}
				className={
					panelTheme === "dark" ? "dark [--drawer-height:55dvh]" : "light [--drawer-height:55dvh]"
				}
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
	onUnfollow,
	selectedStopId,
}: Omit<BusPanelProps, "tracked" | "open" | "onOpenChange"> & { tracked: TrackedBus }) {
	const { map } = useMap();
	const stopList = useRef<HTMLOListElement>(null);
	const listed = stopsAhead.some((arrival) => arrival.stop.id === selectedStopId);

	// Brings the rider's stop into view when the panel opens on it or it changes.
	useEffect(() => {
		if (!listed || selectedStopId === null) return;
		stopList.current
			?.querySelector(`[data-stop="${selectedStopId}"]`)
			?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [listed, selectedStopId]);

	const flyTo = (target: LngLat) => {
		map?.easeTo({ center: target, zoom: Math.max(map.getZoom(), 16), duration: 600 });
	};

	return (
		<>
			{/* In the side panel the bus details stay put and only the stops scroll. The
			    phone sheet is too short for that, so it scrolls as a whole. */}
			<div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pt-1 pb-5 md:min-h-0 md:overflow-visible md:pb-0">
				<section className="flex flex-col gap-3 md:shrink-0">
					<h3 className="text-xs font-semibold text-muted-foreground uppercase">About this bus</h3>
					<SpeedGauge kmh={tracked.speedMps * 3.6} color={color} stale={tracked.stale} />
					{tracked.bus.driver_name ? (
						<p className="text-xs text-muted-foreground">Driver: {tracked.bus.driver_name}</p>
					) : null}
				</section>
				{settling ? (
					<StopsAheadSkeleton />
				) : stopsAhead.length > 0 ? (
					<section className="flex flex-col gap-3 md:min-h-0 md:flex-1">
						<div className="flex items-baseline justify-between md:shrink-0">
							<h3 className="text-xs font-semibold text-muted-foreground uppercase">
								Where it goes next
							</h3>
							<span className="text-xs text-muted-foreground">Tap a stop to see it</span>
						</div>
						<ol
							ref={stopList}
							className="md:-mx-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain md:px-4 md:pb-5"
						>
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
								const chosen = arrival.stop.id === selectedStopId;

								return (
									<li key={arrival.stop.id} data-stop={arrival.stop.id} className="flex gap-3">
										<div className="flex w-6 flex-col items-center">
											<span
												className={cn(
													"mt-3 shrink-0 rounded-full border-2 border-background",
													next
														? "size-4 bg-stop-active ring-2 ring-stop-active/40"
														: chosen
															? "size-4 bg-stop ring-2 ring-stop/40"
															: "size-3 bg-stop",
												)}
											/>
											{last ? null : <span className="w-0.5 flex-1 bg-muted-foreground/25" />}
										</div>
										<button
											type="button"
											onClick={() => {
												onUnfollow();
												haptic("selection");
												onSelectStop(arrival.stop.id);
												flyTo([arrival.stop.lng, arrival.stop.lat]);
											}}
											className={cn(
												"mb-1 flex flex-1 items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent",
												next && "bg-stop-active/10",
												chosen && !next && "bg-stop/10 ring-1 ring-stop/30",
											)}
										>
											<span className="flex min-w-0 flex-col">
												<span
													className={cn(
														"truncate",
														next || chosen ? "font-semibold" : "font-medium",
													)}
												>
													{arrival.stop.name}
												</span>
												<span className="text-xs text-muted-foreground">
													{next ? "Next stop · " : ""}
													{chosen ? "Your stop · " : ""}
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
						<TextMorph>{arrivalLabel(etaSeconds, stale)}</TextMorph>
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

function arrivalLabel(etaSeconds: number | null, stale: boolean): string {
	if (stale || etaSeconds === null) return "Unknown";
	if (etaSeconds < 45) return "Arriving now";

	const minutes = Math.max(1, Math.round(etaSeconds / 60));

	return `in ${minutes} min`;
}

type CardSide = "top" | "bottom" | "left" | "right";

const CARD_SIDES: CardSide[] = ["top", "bottom", "right", "left"];

const SIDE_PLACEMENT: Record<CardSide, { wrapper: string; origin: string }> = {
	top: { wrapper: "card-above", origin: "origin-bottom" },
	bottom: { wrapper: "card-below", origin: "origin-top" },
	left: { wrapper: "card-left", origin: "origin-right" },
	right: { wrapper: "card-right", origin: "origin-left" },
};

// The card's box around the stop for a side.
function cardBox(side: CardSide, threeD: boolean) {
	const w = STOP_CARD_WIDTH;
	const h = STOP_CARD_HEIGHT;
	const gap = side === "top" && threeD ? STOP_CARD_GAP_3D : STOP_CARD_GAP;

	switch (side) {
		case "top":
			return { x0: -w / 2, y0: -gap - h, x1: w / 2, y1: -gap };
		case "bottom":
			return { x0: -w / 2, y0: gap, x1: w / 2, y1: gap + h };
		case "left":
			return { x0: -gap - w, y0: -h / 2, x1: -gap, y1: h / 2 };
		case "right":
			return { x0: gap, y0: -h / 2, x1: gap + w, y1: h / 2 };
	}
}

// Points every few pixels along the road the bus will drive, relative to the stop.
function roadOnScreen(map: MapLibreMap, stop: LngLat, path: LngLat[]) {
	const origin = map.project(stop);
	const points: { x: number; y: number }[] = [];

	for (let i = 0; i < path.length; i++) {
		const b = map.project(path[i]);
		const a = i > 0 ? map.project(path[i - 1]) : b;
		const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));

		for (let k = i > 0 ? 1 : 0; k <= steps; k++) {
			points.push({
				x: a.x + ((b.x - a.x) * k) / steps - origin.x,
				y: a.y + ((b.y - a.y) * k) / steps - origin.y,
			});
		}
	}

	return { origin, points };
}

// The side that hides the least of the coming bus's road and stays on screen.
// The current side wins ties, so the card doesn't hop around for nothing.
function pickCardSide(
	map: MapLibreMap,
	stop: LngLat,
	path: LngLat[],
	threeD: boolean,
	current: CardSide,
): CardSide {
	const { origin, points } = roadOnScreen(map, stop, path);
	const { clientWidth, clientHeight } = map.getContainer();

	const cost = (side: CardSide) => {
		const box = cardBox(side, threeD);
		const covered = points.filter(
			({ x, y }) => x > box.x0 - 6 && x < box.x1 + 6 && y > box.y0 - 6 && y < box.y1 + 6,
		).length;
		const offScreen =
			origin.x + box.x0 < CARD_MARGIN ||
			origin.y + box.y0 < CARD_MARGIN ||
			origin.x + box.x1 > clientWidth - CARD_MARGIN ||
			origin.y + box.y1 > clientHeight - CARD_MARGIN;

		return covered + (offScreen ? 1000 : 0);
	};

	return CARD_SIDES.reduce((best, side) => (cost(side) < cost(best) ? side : best), current);
}

// Opens on the stop itself, growing out of the dot, and fades out in place
// on close. It sits on whichever side keeps the coming bus's road in view,
// and keeps the last stop while the closing animation plays.
function StopCard({
	stop,
	threeD,
	tracker,
	onClosed,
	roadBusId,
	...panel
}: Omit<React.ComponentProps<typeof StopPanel>, "stop" | "arrivals"> & {
	stop: BusStop | null;
	threeD: boolean;
	tracker: BusTracker;
	onClosed: () => void;
	/** The coming bus whose road to draw, else the soonest. */
	roadBusId: number | null;
}) {
	const [shown, setShown] = useState(stop);
	if (stop && stop !== shown) setShown(stop);
	const { map } = useMap();
	const shownId = shown?.id;
	const [cameraMoves, setCameraMoves] = useState(0);

	// After the rider pans or zooms, the road may sit somewhere else on screen.
	useEffect(() => {
		if (!map) return;
		const onMoveEnd = () => setCameraMoves((count) => count + 1);

		map.on("moveend", onMoveEnd);

		return () => {
			map.off("moveend", onMoveEnd);
		};
	}, [map]);

	// Worked out for the shown stop, not the selected one, so the list stays
	// put while the card fades out after the selection is cleared.
	const arrivals = shown && panel.now > 0 ? tracker.arrivalsAt(shown.id, panel.now) : [];

	// Chosen during render on opening and after each camera move, so the card
	// never paints on the wrong side first.
	const placeKey = shown ? `${shown.id}:${cameraMoves}:${threeD}` : "";
	const [placed, setPlaced] = useState<{ key: string; side: CardSide }>({ key: "", side: "top" });
	if (shown && map && placed.key !== placeKey) {
		const path = arrivals.find((arrival) => !arrival.stale)?.path ?? [];
		setPlaced({
			key: placeKey,
			side: pickCardSide(map, [shown.lng, shown.lat], path, threeD, placed.side),
		});
	}
	const side = placed.side;

	// Slides the map just enough to bring a card near an edge fully into view,
	// for when no side fits on screen.
	const fitCard = useEffectEvent(() => {
		if (!map || !shown) return;

		const point = map.project([shown.lng, shown.lat]);
		const { clientWidth, clientHeight } = map.getContainer();
		const box = cardBox(side, threeD);
		const left = point.x + box.x0;
		const right = point.x + box.x1;
		const top = point.y + box.y0;
		const bottom = point.y + box.y1;
		const dx =
			left < CARD_MARGIN
				? left - CARD_MARGIN
				: right > clientWidth - CARD_MARGIN
					? right - (clientWidth - CARD_MARGIN)
					: 0;
		const dy =
			top < CARD_MARGIN
				? top - CARD_MARGIN
				: bottom > clientHeight - CARD_MARGIN
					? bottom - (clientHeight - CARD_MARGIN)
					: 0;

		if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { duration: 500 });
	});

	// Only on opening: a poll that refreshes the stop must not move the map.
	useEffect(() => {
		if (shownId !== undefined) fitCard();
	}, [shownId]);

	const leaving = stop === null && shown !== null;
	const finishClosing = useEffectEvent(onClosed);

	// Mounted in its opening state and switched to open a frame later, so the
	// browser has a starting point to transition from.
	const [entered, setEntered] = useState(false);
	useEffect(() => {
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => setEntered(true));
		});

		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
		};
	}, []);
	const cardState = leaving ? "closing" : entered ? "open" : "opening";

	// Unmounts once the closing animation has played. A timer rather than
	// animationend, which never fires when animations are switched off.
	useEffect(() => {
		if (!leaving) return;
		const timer = setTimeout(() => {
			setShown(null);
			finishClosing();
		}, STOP_CARD_CLOSE_MS);

		return () => clearTimeout(timer);
	}, [leaving]);

	const liveRoad =
		arrivals.find((arrival) => !arrival.stale && arrival.bus.bus_id === roadBusId) ??
		arrivals.find((arrival) => !arrival.stale);
	const road = useHeldUntil(roadStep(liveRoad), liveRoad);

	if (!shown) return null;

	const placement = SIDE_PLACEMENT[side];
	return (
		<>
			{road && road.path.length > 1 ? (
				<RoadAhead path={road.path} color={road.bus.route_color} visible={cardState === "open"} />
			) : null}
			<MapMarker longitude={shown.lng} latitude={shown.lat} className="z-40">
				<MarkerContent>
					<div className="relative size-0">
						<div
							className={cn(
								"absolute top-0 left-0 transition-transform duration-700 ease-in-out",
								placement.wrapper,
							)}
							style={
								{
									"--card-gap": `${side === "top" && threeD ? STOP_CARD_GAP_3D : STOP_CARD_GAP}px`,
								} as React.CSSProperties
							}
						>
							<PanelGlass
								className={cn(
									"w-72 rounded-2xl p-3.5 text-foreground",
									"stop-card",
									placement.origin,
								)}
								data-state={cardState}
								// A swipe between buses must not also drag the map underneath.
								onPointerDown={(event) => event.stopPropagation()}
								onMouseDown={(event) => event.stopPropagation()}
								onTouchStart={(event) => event.stopPropagation()}
							>
								<div className="stop-card-content" data-state={entered ? "open" : "opening"}>
									<StopPanel stop={shown} arrivals={arrivals} roadBusId={roadBusId} {...panel} />
								</div>
							</PanelGlass>
						</div>
					</div>
				</MarkerContent>
			</MapMarker>
		</>
	);
}

// The soonest bus first; the rest are a swipe away, so the card stays one bus
// tall however many are coming.
function StopPanel({
	stop,
	arrivals,
	settling,
	now,
	userPosition,
	onLocate,
	onShowBus,
	onClose,
	roadBusId,
}: {
	stop: BusStop;
	arrivals: StopArrival[];
	roadBusId: number | null;
	settling: boolean;
	now: number;
	userPosition: LngLat | null;
	onLocate: (position: LngLat) => void;
	onShowBus: (busId: number | null) => void;
	onClose: () => void;
}) {
	const [locating, setLocating] = useState(false);
	const [carousel, setCarousel] = useState<CarouselApi>();
	const [shownIndex, setShownIndex] = useState(0);
	const walkSeconds = userPosition
		? (haversineMeters(userPosition, [stop.lng, stop.lat]) * WALK_DETOUR) / WALK_MPS
		: null;
	const shown = arrivals.at(shownIndex) ?? arrivals.at(0);

	const showSlide = useEffectEvent((index: number) => {
		haptic("selection");
		setShownIndex(index);
		onShowBus(arrivals.at(index)?.bus.bus_id ?? null);
	});

	useEffect(() => {
		if (!carousel) return;
		const onSelect = () => showSlide(carousel.selectedScrollSnap());

		carousel.on("select", onSelect);

		return () => {
			carousel.off("select", onSelect);
		};
	}, [carousel]);

	// Back to the soonest bus once the one shown has passed the stop.
	useEffect(() => {
		if (roadBusId === null) carousel?.scrollTo(0);
	}, [carousel, roadBusId]);

	const locate = () => {
		if (!("geolocation" in navigator)) return;
		haptic("light");
		setLocating(true);
		navigator.geolocation.getCurrentPosition(
			(position) => {
				haptic("success");
				onLocate([position.coords.longitude, position.coords.latitude]);
				setLocating(false);
			},
			() => {
				haptic("error");
				setLocating(false);
			},
			{ timeout: 10_000 },
		);
	};

	return (
		<div
			className="flex flex-col"
			style={shown ? ({ "--bus-color": shown.bus.route_color } as React.CSSProperties) : undefined}
		>
			<div className="flex items-start justify-between gap-2">
				<span className="min-w-0 truncate pt-1 text-xs text-muted-foreground">
					Stop {stop.stop_order} · {stop.name}
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close stop"
					className="-mt-1 -mr-1 shrink-0"
					onClick={onClose}
				>
					<X />
				</Button>
			</div>
			{settling ? (
				<div className="pt-1">
					<ArrivalsSkeleton />
				</div>
			) : arrivals.length === 0 ? (
				<Empty size="compact">
					<EmptyHeader>
						<EmptyMedia variant="glass">
							<BusFront />
						</EmptyMedia>
						<EmptyTitle>No bus on the way</EmptyTitle>
						<EmptyDescription>
							The next one shows up here as soon as it heads this way.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				// Fades in over the skeleton when the first bus times arrive.
				<div className="flex animate-in flex-col duration-300 fade-in">
					<Carousel setApi={setCarousel} opts={{ align: "start" }}>
						<CarouselContent>
							{arrivals.map((arrival) => (
								<CarouselItem key={arrival.bus.bus_id}>
									<ArrivalSlide
										arrival={arrival}
										now={now}
										walkSeconds={walkSeconds}
										walkButton={
											<Button
												variant="outline"
												size="sm"
												className="shrink-0"
												onClick={locate}
												disabled={locating}
												title="Leave times then allow for your walk to this stop"
											>
												<LocateFixed data-icon="inline-start" />
												{locating ? "Finding you…" : "Walking time"}
											</Button>
										}
									/>
								</CarouselItem>
							))}
						</CarouselContent>
					</Carousel>
					{arrivals.length > 1 ? (
						<div className="flex items-center justify-center gap-1.5 pt-3">
							{arrivals.map((arrival, index) => (
								<button
									key={arrival.bus.bus_id}
									type="button"
									aria-label={`Show ${arrival.bus.bus_name}`}
									aria-current={index === shownIndex}
									onClick={() => carousel?.scrollTo(index)}
									className={cn(
										"h-1.5 cursor-pointer rounded-full transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
										index === shownIndex
											? "w-4 bg-foreground"
											: "w-1.5 bg-foreground/30 hover:bg-foreground/50",
									)}
								/>
							))}
						</div>
					) : null}
					{walkSeconds === null ? null : (
						<span className="pt-3 text-xs text-muted-foreground" suppressHydrationWarning>
							About {formatMinutes(walkSeconds)} walk from you. Leave times allow for it.
						</span>
					)}
				</div>
			)}
		</div>
	);
}

// One bus in the stop card: when it arrives, then which bus and how far.
function ArrivalSlide({
	arrival,
	now,
	walkSeconds,
	walkButton,
}: {
	arrival: StopArrival;
	now: number;
	walkSeconds: number | null;
	walkButton: React.ReactNode;
}) {
	const { bus, etaSeconds, stale, metersAhead } = arrival;

	return (
		<div style={{ "--bus-color": bus.route_color } as React.CSSProperties}>
			{etaSeconds !== null && !stale ? (
				<div className="flex items-baseline gap-1.5 pt-1" suppressHydrationWarning>
					<span className="text-3xl leading-tight font-bold tabular-nums">
						<TextMorph>{clockParts(now, etaSeconds).time}</TextMorph>
					</span>
					<span className="text-sm font-semibold">{clockParts(now, etaSeconds).period}</span>
					<span className="text-sm text-muted-foreground tabular-nums">
						<TextMorph>
							{`· ${etaSeconds < 45 ? "arriving now" : `in ${formatEta(etaSeconds, false)}`}`}
						</TextMorph>
					</span>
				</div>
			) : (
				<span className="block pt-1 text-3xl leading-tight font-bold">
					{etaSeconds !== null ? formatEta(etaSeconds, stale) : "—"}
				</span>
			)}
			<div className="flex items-center justify-between gap-2 pt-2 text-xs">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="size-2 shrink-0 rounded-full bg-(--bus-color)" />
					<span className="shrink-0 font-semibold">{bus.bus_name}</span>
					<span className="truncate text-muted-foreground">
						<TextMorph>{`· ${formatDistance(metersAhead)}`}</TextMorph>
					</span>
				</span>
				{walkSeconds !== null ? (
					etaSeconds !== null && !stale ? (
						<span className="shrink-0 font-medium tabular-nums">
							<TextMorph>{formatLeave(etaSeconds - walkSeconds)}</TextMorph>
						</span>
					) : null
				) : (
					walkButton
				)}
			</div>
		</div>
	);
}

// The arrival clock split so the hour and minutes can be big and AM/PM small.
function clockParts(now: number, etaSeconds: number): { time: string; period: string } {
	const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(
		new Date(now + etaSeconds * 1000),
	);
	const period = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
	const time = parts
		.filter((part) => part.type !== "dayPeriod")
		.map((part) => part.value)
		.join("")
		.trim();

	return { time, period };
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
