# Contributing to degu

Thanks for your interest in contributing. degu is a local-first media browser SPA (Preact + Vite + TypeScript) with no backend.

## Dev setup

```bash
npm install
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build → dist/index.html
npm run preview      # serve the production bundle
npm test             # Vitest (run mode)
npm run test:watch   # Vitest watch
```

`npm run build` must pass before a change is ready to merge.

## Code style

- **Preact 10 + hooks** (`preact/hooks`, `preact/compat` for `memo`). No new UI frameworks.
- **Tailwind CSS v4** utility classes in JSX (`class=`). No CSS-in-JS or CSS modules.
- **TypeScript** throughout; preserve existing async cancellation patterns (`cancelled` flags in `useEffect`, `AbortSignal` for long scans / trim).
- **Pure helpers** live in `src/lib/` with a sibling `*.test.ts`. Component tests use `@testing-library/preact` with a per-file `/** @vitest-environment happy-dom */` directive.
- Keep diffs focused; avoid drive-by refactors and unrelated files.

See [`agents.md`](agents.md) for the full architecture map, domain concepts (connected root, tag/loop storage in `index.json`, URL-hash routing), and conventions.

## Workflow

1. **Open an issue first** for non-trivial changes (new features, API/data-format changes, anything touching `index.json` schema or the trim pipeline). Drive-by typo fixes can skip straight to a PR.
2. **Branch + PR** against `main`. Fill in the PR template (what / why / testing / checklist).
3. **Sign off your commits** with `git commit -s` — every commit must carry a `Signed-off-by:` trailer (Developer Certificate of Origin, [developercertificate.org](https://developercertificate.org)). PRs without sign-off will be asked to amend.
4. **Update `agents.md`** if you change architecture, add a new module under `src/lib/`, or introduce new conventions.

## Licensing of contributions

degu is licensed under **AGPL-3.0-or-later**. By submitting a contribution you agree that it is licensed under the same terms. There is **no CLA** — the DCO sign-off (`-s`) is the only attestation required.

## Reporting security issues

Don't open a public issue for vulnerabilities. See [`SECURITY.md`](SECURITY.md).
