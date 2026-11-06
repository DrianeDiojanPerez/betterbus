//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config";
import pluginQuery from "@tanstack/eslint-plugin-query";
import reactHooks from "eslint-plugin-react-hooks";

export default [
	...tanstackConfig,
	...pluginQuery.configs["flat/recommended"],
	{
		rules: {
			"import/no-cycle": "off",
			"import/order": "off",
			"import/consistent-type-specifier-style": "off",
			"sort-imports": "off",
			"@typescript-eslint/array-type": "off",
			"@typescript-eslint/require-await": "off",
			"pnpm/json-enforce-catalog": "off",
		},
	},
	{
		files: ["src/components/ui/**", "src/hooks/use-mobile.ts", "src/lib/highlighter.tsx"],
		plugins: { "react-hooks": reactHooks },
		rules: {
			"no-shadow": "off",
			"@typescript-eslint/naming-convention": "off",
			"react-hooks/exhaustive-deps": "error",
			"@typescript-eslint/no-unnecessary-condition": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
		},
	},
	{
		ignores: ["eslint.config.js", ".prettierrc"],
	},
];
