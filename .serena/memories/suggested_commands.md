# Suggested Commands

## Development
- `npm run dev` — run the bot with `tsx watch src/index.ts`
- `npm start` — run the compiled bot from `dist/index.js`

## Build and Validation
- `npm run type-check` — strict TypeScript validation without emitting
- `npm run build` — compile TypeScript and rewrite path aliases with `tsc-alias`
- `npm run knip` — detect unused files, exports, and dependencies
- `npm run clean` — remove `dist/`
- `npm run format` — format `src/**/*.{ts,js}` with Prettier

## Tests
- `npx tsx --test src/tests/...` — run focused subsystem tests
- For HSM, AI, or memory changes, run the relevant focused tests under `src/tests/`

## Windows Utility Commands
- `git` for version control
- `Get-ChildItem` / `dir` for directory listing
- `Set-Location` / `cd` for navigation
- `rg` for fast search
- PowerShell for local scripting and inspection