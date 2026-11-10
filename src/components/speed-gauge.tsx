import { cn } from "@/lib/utils";

const MAX_KMH = 60;
const SWEEP_DEG = 240;
const CENTER = 60;
const RADIUS = 46;
const TICKS = [0, 10, 20, 30, 40, 50, 60];

// Degrees clockwise from straight up.
function angleFor(kmh: number): number {
	return (Math.min(Math.max(kmh, 0), MAX_KMH) / MAX_KMH) * SWEEP_DEG - SWEEP_DEG / 2;
}

function pointAt(angle: number, radius: number): [number, number] {
	const radians = (angle * Math.PI) / 180;

	return [CENTER + radius * Math.sin(radians), CENTER - radius * Math.cos(radians)];
}

const [startX, startY] = pointAt(-SWEEP_DEG / 2, RADIUS);
const [endX, endY] = pointAt(SWEEP_DEG / 2, RADIUS);
const ARC = `M ${startX} ${startY} A ${RADIUS} ${RADIUS} 0 1 1 ${endX} ${endY}`;

export function SpeedGauge({
	kmh,
	color,
	stale,
	className,
}: {
	kmh: number;
	color: string;
	stale: boolean;
	className?: string;
}) {
	const angle = angleFor(kmh);
	const filled = ((angle + SWEEP_DEG / 2) / SWEEP_DEG) * 100;

	return (
		<div
			className={cn("relative mx-auto w-full max-w-56", className)}
			style={{ "--bus-color": color, "--needle": `${angle}deg` } as React.CSSProperties}
		>
			<svg viewBox="0 0 120 100" className="w-full overflow-visible" aria-hidden>
				<path
					d={ARC}
					fill="none"
					strokeWidth={8}
					strokeLinecap="round"
					className="stroke-foreground/10"
				/>
				<path
					d={ARC}
					fill="none"
					strokeWidth={8}
					strokeLinecap="round"
					pathLength={100}
					strokeDasharray="100 100"
					strokeDashoffset={100 - filled}
					className={cn(
						"transition-all duration-300 ease-out",
						stale ? "stroke-muted-foreground/40" : "stroke-(--bus-color)",
					)}
				/>
				{TICKS.map((tick) => {
					const tickAngle = angleFor(tick);
					const [x1, y1] = pointAt(tickAngle, RADIUS - 9);
					const [x2, y2] = pointAt(tickAngle, RADIUS - 13);
					const [labelX, labelY] = pointAt(tickAngle, RADIUS - 21);

					return (
						<g key={tick} className="text-muted-foreground">
							<line
								x1={x1}
								y1={y1}
								x2={x2}
								y2={y2}
								stroke="currentColor"
								strokeWidth={1.5}
								strokeLinecap="round"
							/>
							<text
								x={labelX}
								y={labelY}
								textAnchor="middle"
								dominantBaseline="central"
								fill="currentColor"
								fontSize={7}
							>
								{tick}
							</text>
						</g>
					);
				})}
				{/* The empty ring centers the group's box on the hub, so it turns there. */}
				<g className="origin-center rotate-(--needle) text-foreground transition-transform duration-300 ease-out transform-fill">
					<circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" />
					<line
						x1={CENTER}
						y1={CENTER + 6}
						x2={CENTER}
						y2={CENTER - RADIUS + 16}
						stroke="currentColor"
						strokeWidth={2.5}
						strokeLinecap="round"
					/>
				</g>
				<circle cx={CENTER} cy={CENTER} r={4} className="fill-foreground" />
			</svg>
			<div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-none">
				<span className="text-3xl font-bold tabular-nums">{Math.round(kmh)}</span>
				<span className="mt-1 text-xs text-muted-foreground">km/h</span>
			</div>
		</div>
	);
}
