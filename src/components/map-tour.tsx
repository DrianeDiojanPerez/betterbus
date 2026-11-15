import { useEffect, useState } from "react";

import { TourWelcome, useTour } from "@/components/tour";
import type { TourStep } from "@/components/tour";

export const TOUR_STORAGE_KEY = "betterbus-tour";

function Step({ title, children }: { title: string; children: string }) {
	return (
		<div className="flex flex-col gap-1.5 pr-2">
			<h3 className="text-base font-semibold">{title}</h3>
			<p className="text-muted-foreground">{children}</p>
		</div>
	);
}

const STEPS: TourStep[] = [
	{
		target: ".maplibregl-canvas",
		side: "center",
		content: (
			<Step title="The buses, live">
				Every E-Bus on the road right now, moving as it drives. The blue line is the route it
				follows.
			</Step>
		),
	},
	{
		target: '[data-tour="bus"]',
		side: "right",
		content: (
			<Step title="Follow a bus">
				Tap a bus to follow it and see the stops it reaches next. Pick one of them to see the road
				left to get there.
			</Step>
		),
	},
	{
		target: '[data-tour="stop"]',
		side: "right",
		content: (
			<Step title="Check a stop">
				Tap a stop to see when the next bus arrives. Swipe the card to see the bus after it.
			</Step>
		),
	},
	{
		target: '[aria-label="Find my location"]',
		side: "left",
		content: (
			<Step title="Find your stop">
				Opens the stop nearest you, the walk to it, and when to leave so you catch the bus.
			</Step>
		),
	},
	{
		target: '[aria-label^="Turn 3D view"]',
		side: "left",
		content: <Step title="3D view">Tilt the map to see the buildings and buses standing up.</Step>,
	},
	{
		target: '[aria-label="Settings"]',
		side: "left",
		content: (
			<Step title="Settings">
				Light or dark, and the map style. You can take this tour again from here.
			</Step>
		),
	},
];

/** Offers the tour once the map and buses are showing, a moment after, on a first visit. */
export function MapTour({ ready }: { ready: boolean }) {
	const { setSteps, done } = useTour();
	const [open, setOpen] = useState(false);

	useEffect(() => setSteps(STEPS), [setSteps]);

	useEffect(() => {
		if (done || !ready) return;
		const wait = window.setTimeout(() => setOpen(true), 1000);

		return () => window.clearTimeout(wait);
	}, [done, ready]);

	return (
		<TourWelcome
			open={open}
			onOpenChange={setOpen}
			title="Welcome to E-Bus"
			description="Live buses around Belize City. Six quick stops show you the way round."
			icon={<img src="/logo192.png" alt="" className="size-16 rounded-2xl shadow-lg" />}
		/>
	);
}
