import { useHotkey } from "@tanstack/react-hotkeys";
import { AnimatePresence, motion } from "motion/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { PanelGlass } from "@/components/panel-glass";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { useLiquidGlass, usePanelTheme } from "@/lib/settings";
import { cn } from "@/lib/utils";

/*
 * Whether the tour was finished lives in storage, so it is read as an external
 * store. A finish is also kept in memory, since private browsing can refuse
 * the write and the tour still has to stay closed.
 */
const finishedNow = new Set<string>();
const listeners = new Set<() => void>();

function finished(key: string): boolean {
	if (finishedNow.has(key)) return true;

	try {
		return localStorage.getItem(key) === "done";
	} catch {
		return false;
	}
}

function finish(key: string) {
	finishedNow.add(key);

	try {
		localStorage.setItem(key, "done");
	} catch {
		// Storage that cannot be written only means the tour is offered again next time.
	}

	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	window.addEventListener("storage", listener);

	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", listener);
	};
}

export type TourSide = "top" | "bottom" | "left" | "right" | "center";

export type TourStep = {
	/** A CSS selector for what the step points at; the first match on screen is used. */
	target: string;
	content: ReactNode;
	side?: TourSide;
};

type Box = { top: number; left: number; width: number; height: number };

type TourState = {
	steps: TourStep[];
	setSteps: (steps: TourStep[]) => void;
	active: boolean;
	done: boolean;
	start: () => void;
	end: () => void;
};

const TourContext = createContext<TourState | null>(null);

const GAP = 6;
const MARGIN = 16;
const CARD_WIDTH = 288;

const GLIDE = { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const };

/**
 * Where the match on screen nearest the middle is, with a little room around
 * it, so a stop or a bus at the very edge is not the one picked.
 */
function measure(target: string): Box | null {
	let best: { rect: DOMRect; distance: number } | null = null;

	for (const element of document.querySelectorAll(target)) {
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		if (rect.left < 0 || rect.top < 0) continue;
		if (rect.right > window.innerWidth || rect.bottom > window.innerHeight) continue;

		const distance = Math.hypot(
			rect.left + rect.width / 2 - window.innerWidth / 2,
			rect.top + rect.height / 2 - window.innerHeight / 2,
		);
		if (!best || distance < best.distance) best = { rect, distance };
	}

	if (!best) return null;
	const { rect } = best;

	return {
		top: rect.top - GAP,
		left: rect.left - GAP,
		width: rect.width + GAP * 2,
		height: rect.height + GAP * 2,
	};
}

function place(box: Box, side: TourSide, height: number) {
	let top = box.top + box.height / 2 - height / 2;
	let left = box.left + box.width / 2 - CARD_WIDTH / 2;

	if (side === "top") top = box.top - height - MARGIN;
	if (side === "bottom") top = box.top + box.height + MARGIN;
	if (side === "left") left = box.left - CARD_WIDTH - MARGIN;
	if (side === "right") left = box.left + box.width + MARGIN;

	return {
		top: Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN)),
		left: Math.max(MARGIN, Math.min(left, window.innerWidth - CARD_WIDTH - MARGIN)),
	};
}

// The shade is one polygon that runs round the outside and back in along the
// box, which leaves the box itself clear.
function hole(box: Box) {
	const right = box.left + box.width;
	const bottom = box.top + box.height;

	return `polygon(0px 0px, 0px 100%, 100% 100%, 100% 0px, ${box.left}px 0px, ${box.left}px ${box.top}px, ${right}px ${box.top}px, ${right}px ${bottom}px, ${box.left}px ${bottom}px, ${box.left}px 0px)`;
}

export function TourProvider({
	children,
	storageKey,
}: {
	children: ReactNode;
	storageKey: string;
}) {
	const [steps, setSteps] = useState<TourStep[]>([]);
	const [run, setRun] = useState<TourStep[]>([]);
	const [step, setStep] = useState(-1);
	const done = useSyncExternalStore(
		subscribe,
		() => finished(storageKey),
		() => false,
	);
	const [box, setBox] = useState<Box | null>(null);
	const [tall, setTall] = useState(160);

	// The card's height decides where it sits, and its text changes with every
	// step, so it is watched rather than measured once.
	const card = useCallback((node: HTMLDivElement | null) => {
		if (!node) return;

		setTall(node.offsetHeight);
		const watch = new ResizeObserver(() => setTall(node.offsetHeight));
		watch.observe(node);

		return () => watch.disconnect();
	}, []);

	const end = useCallback(() => {
		setStep(-1);
		finish(storageKey);
	}, [storageKey]);

	// Only the steps whose target is on screen are walked, so a bus that is not
	// running or a stop out of view is passed over.
	const start = useCallback(() => {
		const here = steps.filter((item) => measure(item.target));
		if (here.length === 0) return;

		setRun(here);
		setStep(0);
	}, [steps]);

	const next = useCallback(() => {
		haptic("selection");
		if (step >= run.length - 1) end();
		else setStep(step + 1);
	}, [step, run.length, end]);

	const back = useCallback(() => {
		haptic("selection");
		setStep((current) => Math.max(0, current - 1));
	}, []);

	const current = step >= 0 ? run[step] : undefined;

	// The box is a measurement of the target, so it can only be taken after
	// the render that put it on screen, and once more after it settles.
	/* oxlint-disable react/set-state-in-effect */
	useEffect(() => {
		if (!current) {
			setBox(null);
			return;
		}

		const update = () => setBox(measure(current.target));
		update();
		const settled = window.setTimeout(update, 400);
		window.addEventListener("resize", update);

		return () => {
			window.clearTimeout(settled);
			window.removeEventListener("resize", update);
		};
	}, [current]);
	/* oxlint-enable react/set-state-in-effect */

	const running = { enabled: Boolean(current) };

	useHotkey("Escape", end, running);
	useHotkey("ArrowRight", next, running);
	useHotkey("Enter", next, running);
	useHotkey("ArrowLeft", back, running);

	const value = useMemo<TourState>(
		() => ({ steps, setSteps, active: step >= 0, done, start, end }),
		[steps, step, done, start, end],
	);

	const at = box && current ? place(box, current.side ?? "bottom", tall) : null;

	return (
		<TourContext.Provider value={value}>
			{children}
			{typeof document !== "undefined" &&
				createPortal(
					<AnimatePresence>
						{current && box && at ? (
							<motion.div
								key="tour"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.25 }}
								className="fixed inset-0 z-60"
							>
								<motion.div
									initial={false}
									animate={{ clipPath: hole(box) }}
									transition={GLIDE}
									className="absolute inset-0 bg-black/50"
								/>
								<motion.div
									initial={false}
									animate={{ top: box.top, left: box.left, width: box.width, height: box.height }}
									transition={GLIDE}
									className="pointer-events-none absolute rounded-2xl shadow-halo ring-2 ring-primary"
								/>
								<motion.div
									ref={card}
									role="dialog"
									aria-label="Tour"
									initial={false}
									animate={{ top: at.top, left: at.left }}
									transition={GLIDE}
									className="absolute w-72"
								>
									<PanelGlass className="rounded-2xl p-4 text-sm text-foreground">
										<AnimatePresence mode="wait" initial={false}>
											<motion.div
												key={step}
												initial={{ opacity: 0, scale: 0.97, filter: "blur(4px)" }}
												animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
												exit={{ opacity: 0, scale: 0.97, filter: "blur(4px)" }}
												transition={{ duration: 0.2 }}
											>
												{current.content}
											</motion.div>
										</AnimatePresence>
										<div className="mt-4 flex items-center justify-between gap-3">
											<div
												className="flex items-center gap-1"
												aria-label={`Step ${step + 1} of ${run.length}`}
											>
												{run.map((item, index) => (
													<span
														key={item.target}
														className={cn(
															"h-1.5 rounded-full transition-all duration-300",
															index === step ? "w-4 bg-foreground" : "w-1.5 bg-foreground/30",
														)}
													/>
												))}
											</div>
											<div className="flex items-center gap-1">
												{step > 0 ? (
													<Button variant="ghost" size="sm" onClick={back}>
														Back
													</Button>
												) : (
													<Button variant="ghost" size="sm" onClick={end}>
														Skip
													</Button>
												)}
												<Button variant="outline" size="sm" onClick={next}>
													{step === run.length - 1 ? "Done" : "Next"}
												</Button>
											</div>
										</div>
									</PanelGlass>
								</motion.div>
							</motion.div>
						) : null}
					</AnimatePresence>,
					document.body,
				)}
		</TourContext.Provider>
	);
}

export function useTour() {
	const context = useContext(TourContext);
	if (!context) throw new Error("useTour needs a TourProvider above it");

	return context;
}

export function TourWelcome({
	open,
	onOpenChange,
	title,
	description,
	icon,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	icon: ReactNode;
}) {
	const { start, end, done, active, steps } = useTour();
	const panelTheme = usePanelTheme();
	const liquidGlass = useLiquidGlass();

	if (done || active || steps.length === 0) return null;

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent
				size="sm"
				glass={liquidGlass ? panelTheme : "frosted"}
				className={panelTheme === "dark" ? "dark" : "light"}
			>
				<AlertDialogHeader>
					<motion.div
						initial={{ scale: 0.7, filter: "blur(8px)" }}
						animate={{ scale: 1, filter: "blur(0px)" }}
						transition={{ duration: 0.4, ease: "easeOut" }}
						className="mb-2 flex"
					>
						{icon}
					</motion.div>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<Button
						variant="ghost"
						onClick={() => {
							onOpenChange(false);
							end();
						}}
					>
						Skip
					</Button>
					<Button
						variant="outline"
						onClick={() => {
							onOpenChange(false);
							start();
						}}
					>
						Show me around
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
