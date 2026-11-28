# Green Light Pay · July Reference Sandbox

## Find your way in

| If you are… | Start here | Try this |
| --- | --- | --- |
| A payments developer | [Read the sandbox core](src/core.mjs) | Follow the historical fictional checkout. |
| A tester | [Inspect the core test](test/core.test.mjs) | Trace the $42.50 fixture and repeated request. |
| A merchant builder | [Visit the merchant sandbox](https://github.com/jonathanbabec5-hash/potify-glp-merchant-sandbox) | Compare the separate recovered counter experience. |

[Complete repository directory tree](docs/DIRECTORY.md)

## A July checkout you can still put under a microscope

Keeping an old experiment intact lets a new maintainer ask a better question than ‘does this look current?’ They can ask exactly what the July team meant by an intent, a register and a receipt, then decide which assumptions still hold.

In the [core test](test/core.test.mjs), a synthetic checkout starts with 4,250 US cents and an idempotency key. The [sandbox core](src/core.mjs) handles the fixture locally. The July 22 handoff labels this historical reference; it is not the canonical merchant backend.

Trace that $42.50 fictional intent and record what a repeat request should do. Name one assumption you would recheck before reusing the design. No commercial provider, real funds or settlement is implied; Green Light Pay’s finances, contracts and governance are separate.

**Historical runnable sandbox.** Give developers a reproducible baseline for the July merchant checkout experiment.

### Setup and usage

Node.js 24 and npm. Run the install command before running the build checks.

```sh
npm ci
HOST=127.0.0.1 npm start
```

Run the historical sandbox tests. Open http://127.0.0.1:4173 in a browser. 

### Developer entry points

A local Node server implements fictional intents, partner checks, checkout, reconciliation and a playable customer handoff. A separate developer interface queries the same fixture system. Explore `data/`, `public/`, `src/`, `test/` in the full tree.

### Verification

The original local test suite passed against the historical sandbox. Recorded fixture flows do not evidence a commercial provider or live settlement.

```sh
node --test
```

### Release scope

The July 22 controlling handoff labels this code non-canonical reference only. It is a separate archival repo, with no claim of current Replit backend parity. Green_Light_Pay_Sandbox_v0.1.1_2026-07-20.zip. The July 22 continuation handoff explicitly isolates this version as a historical reference. Only code, fictional fixtures, tests and dependency files are included.

[Technical whitepaper](docs/WHITEPAPER.md) · [Marketing and sales plan](docs/MARKETING.md) · [Dated developer log](docs/BUILD-LOG.md)

Existing asset and code terms remain applicable. Public access to a recording, illustration, brand or manuscript does not itself grant commercial reuse rights.
