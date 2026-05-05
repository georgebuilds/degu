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

degu runs entirely in the browser with no backend; the most relevant attack surfaces are the File System Access API integration, `index.json` parsing, and the `ffmpeg.wasm` trim pipeline.
