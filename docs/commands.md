# Commands

| Command                   | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `npm run dev`             | Starts the dev server on http://localhost:3000                        |
| `npm run build`           | Builds for production                                                 |
| `npm run preview`         | Serves the production build                                           |
| `npm run typecheck`       | Checks types with `tsc`                                               |
| `npm run lint`            | Runs oxlint, then eslint                                              |
| `npm run check`           | Checks formatting with prettier                                       |
| `npm run format`          | Fixes formatting with prettier                                        |
| `npm test`                | Runs the tests once with vitest                                       |
| `npm run generate-routes` | Regenerates `src/routeTree.gen.ts` (the dev server does this for you) |

To add a shadcn component:

```
npx shadcn@latest add button
```

It lands in `src/components/ui/`.
