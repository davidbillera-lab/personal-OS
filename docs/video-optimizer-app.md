# Video Optimizer App — imported into Mission Control

- Path: `projects/video-optimizer-app`
- Source: https://github.com/davidbillera-lab/video-optimizer-app

Imported items:
- `README.md` copied in-place in project root (original repo)
- Added `CLAUDE.md` for Mission Control context
- Added `.env.example` with expected env variable names

No `skills` or `agents` were present in the upstream repo. If you want this project to supply skills or agents to the OS, tell me which behaviors to extract and I will create skill files under `personal-os/.claude/skills/` and agent definitions under `personal-os/agents/`.

To run locally:
- Copy `.env.example` to `.env.local` and fill secrets
- Install with `pnpm install` (or `npm install`)
- Run dev (client+server) according to `README.md`

Mission Control notes:
- This project is now part of the workspace and visible in the VS Code Explorer.
- I can extract and register skills/agents into MC if you want automated tools to call them.
