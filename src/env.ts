import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Server functions share modules with the browser bundle, where there is no
// process; there the server values are never read.
const runtimeEnv = typeof process === "undefined" ? {} : process.env;

export const env = createEnv({
	server: {
		/** The bus feed, set in .env. Point it at a local replay while the buses are off. */
		LIVE_MAP_FEED_URL: z.url(),
	},
	runtimeEnv,
	emptyStringAsUndefined: true,
});
