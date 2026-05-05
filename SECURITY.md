# Security policy

## Reporting a vulnerability

Please email **degu.barstool750 [at] passmail [dot] net** (replace [at] with @ and [dot] with .) with details. Do **not** open a public GitHub issue for security-sensitive reports.

Include, where possible:

- A description of the issue and its impact.
- Steps to reproduce (or a proof-of-concept).
- The commit / release you tested against.
- Any suggested mitigation.

## What to expect

- Acknowledgement within **~7 days**.
- A follow-up with an assessment and remediation plan, or a reasoned decline.
- Credit in release notes if you'd like it (let us know).

degu runs in two modes. In its primary mode a Go HTTP server (Wails desktop app or `degu` CLI) binds to loopback and reads/writes a SQLite tag store next to your media; in File System Access fallback mode the SPA runs entirely in the browser with no backend. The most relevant attack surfaces are the File System Access API integration, `index.json` parsing, and the `ffmpeg.wasm` trim pipeline. The localhost HTTP server listens only on `127.0.0.1`, but any other process or browser tab on the same machine can reach it — treat the loopback origin as trusted only to the extent your local environment is.
