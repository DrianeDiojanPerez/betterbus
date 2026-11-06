import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import { THEME_BOOT_SCRIPT } from "@/lib/settings";

import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";

import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "BetterBus",
			},
			{
				name: "description",
				content: "Live positions of Belize City buses.",
			},
		],
		links: [
			{ rel: "preconnect", href: "https://tiles.openfreemap.org", crossOrigin: "anonymous" },
			{
				rel: "preload",
				as: "font",
				type: "font/woff2",
				href: interLatin,
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
		scripts: [{ children: THEME_BOOT_SCRIPT }],
	}),
	notFoundComponent: () => (
		<main className="container mx-auto p-4 pt-16">
			<h1>404</h1>
			<p>The requested page could not be found.</p>
		</main>
	),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
						{
							name: "Tanstack Query",
							render: <ReactQueryDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
