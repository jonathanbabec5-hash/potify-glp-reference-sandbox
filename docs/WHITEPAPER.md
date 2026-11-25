# Green Light Pay · July Reference Sandbox
## Whitepaper · public developer edition

**November 25, 2026 · Historical runnable sandbox**

### Goal and audience

Give developers a reproducible baseline for the July merchant checkout experiment. The immediate audience is fintech developers and merchant operations researchers.

### Design and implementation

A local Node server implements fictional intents, partner checks, checkout, reconciliation and a playable customer handoff. A separate developer interface queries the same fixture system. Keep the July reference in an independent repository so reviewers can reproduce a historical result without introducing its assumptions into the consumer app.

### What a contributor can establish

The original local test suite passed against the historical sandbox. Recorded fixture flows do not evidence a commercial provider or live settlement. Compare the server output for a simulated intent with the fixture contract, and write down the first requirement that has changed since July.

### Evidence and outstanding work

The July 22 controlling handoff labels this code non-canonical reference only. It is a separate archival repo, with no claim of current Replit backend parity. The next acceptance case is concrete. Complete the archived test suite using a disposable database and distinguish a fixture receipt from a provider settlement.

### Place in POTIFY

Use the walkthrough to qualify one independently scoped GLP engineering workshop. The marketing plan gives the test window and the evidence for a commercial outcome.

[Source provenance](source.json) · [Build log](BUILD-LOG.md) · [Marketing plan](MARKETING.md)
