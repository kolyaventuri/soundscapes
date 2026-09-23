# Repository guidance

- Runtime and stack are not yet defined. Do not treat tooling preferences as stack decisions.
- Prefer `pnpm` for package management and `xo` for linting and `vitest` for tests, unless the project is configured otherwise.
- When using Node.js, use the shell-configured version. If it is older than the latest LTS, advise an upgrade.
- Close Chrome and other browser sessions you open as soon as they are no longer needed. Preserve pre-existing user sessions and tabs.
- Stop servers and other background processes you start when their work is complete, unless explicitly asked to leave them running. Preserve pre-existing processes.
- Use Conventional Commits. Commit completed work frequently in small, coherent chunks rather than accumulating a large change. Include only changes relevant to the task.
- Update this file when new project requirements are agreed upon. Keep instructions precise and concise; remove obsolete guidance and avoid speculative rules or filler.
