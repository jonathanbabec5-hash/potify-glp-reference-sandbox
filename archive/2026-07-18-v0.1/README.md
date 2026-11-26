# Green Light Pay sandbox v0.1.0

This directory preserves the July 18, 2026 local checkout prototype. The operator creates a fictional payment request, records simulated screening and two observer reports, then reconciles the result against the local ledger. All activity uses a local SQLite database and demonstration records.

## Run the historical edition

From this directory, use Node.js 24 or later. The application has no third-party package dependencies.

```sh
sha256sum -c SHA256SUMS
npm test
HOST=127.0.0.1 npm start
```

Open `http://127.0.0.1:4173` for the original counter dashboard. The server creates `data/greenlight-pay.sqlite` on the first run. The automated suite runs with isolated fixtures.

## Provenance

The source archive was `Green_Light_Pay_Sandbox_v0.1_2026-07-18.zip` with SHA-256 `9fd7bd4549aa380ac8bd8b9c8054e4719e3f25780d1823b06a83ff0a34276a1c`. The ten files listed in `SHA256SUMS` preserve their original paths and bytes. This recovery includes the local server, core logic, interface, tests and supporting runtime files. The README and checksum file were added for this public edition. The original planning and research documents remain in the owner archive.

The repository root holds the July 20 reference edition. The separate hosted Green Light Pay workspace has its own source history. These local fixtures establish the behavior of the July 18 experiment.
