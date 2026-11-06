import { Skeleton } from "@/components/ui/skeleton";

export function ArrivalsSkeleton() {
	return (
		<ol className="flex flex-col gap-2" aria-label="Loading arrivals">
			{[0, 1].map((row) => (
				<li key={row} className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between gap-2">
						<Skeleton className="h-3 w-24" />
						<Skeleton className="h-3 w-20" />
					</div>
					<Skeleton className="h-2.5 w-36" />
				</li>
			))}
		</ol>
	);
}

export function StopsAheadSkeleton() {
	return (
		<ol className="flex flex-col" aria-label="Loading stops">
			{[0, 1, 2, 3].map((row) => (
				<li key={row} className="flex gap-3">
					<div className="flex w-6 flex-col items-center">
						<Skeleton className="mt-3 size-3 shrink-0" />
						{row === 3 ? null : <span className="w-0.5 flex-1 bg-muted-foreground/25" />}
					</div>
					<div className="mb-1 flex flex-1 items-start justify-between gap-3 px-2 py-1.5">
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-3.5 w-32" />
							<Skeleton className="h-2.5 w-20" />
						</div>
						<Skeleton className="h-3.5 w-14" />
					</div>
				</li>
			))}
		</ol>
	);
}
