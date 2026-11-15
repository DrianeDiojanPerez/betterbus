import { defineConfig, loadEnv } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig(({ mode }) => {
	// Vite keeps .env values off process.env, where src/env.ts reads them on the
	// server, so they are copied over. Values already set in the shell win.
	process.env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

	return {
		resolve: { tsconfigPaths: true },
		plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
	};
});

export default config;
