# Repository guidance

- Follow `SPEC.md` for product requirements and update `PLAN.md` checklists with evidence as work lands. Keep physical iPhone and overnight acceptance separate from automated checks.
- Stack: Node.js 24 LTS and TypeScript; pnpm workspace with React/Vite in `apps/web`, Fastify in `apps/server`, and browser-safe schemas/types in `packages/shared`.
- Keep inference local behind replaceable adapters. Prove HLS playback and pause/watchdog lifecycle before AI integration. Use FFmpeg for DSP and SQLite/filesystem storage when those phases are implemented.
- Run `pnpm check` before committing code. Never commit local data, generated audio, model weights, or secrets.
- For audio or session lifecycle changes, also run `pnpm audio:smoke` and `pnpm audio:integration` with real FFmpeg. Status/playlist polling must not keep a listener active; explicit pause must remain idle despite stale requests.
- Prefer `pnpm` for package management and `xo` for linting and `vitest` for tests, unless the project is configured otherwise.
- When using Node.js, use the shell-configured version. If it is older than the latest LTS, advise an upgrade.
- Close Chrome and other browser sessions you open as soon as they are no longer needed. Preserve pre-existing user sessions and tabs.
- Stop servers and other background processes you start when their work is complete, unless explicitly asked to leave them running. Preserve pre-existing processes.
- Use Conventional Commits. Commit completed work frequently in small, coherent chunks rather than accumulating a large change. Include only changes relevant to the task.
- Update this file when new project requirements are agreed upon. Keep instructions precise and concise; remove obsolete guidance and avoid speculative rules or filler.
