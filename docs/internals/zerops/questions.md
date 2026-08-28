# Open questions

Unknowns that block a real implementation. Each says what it blocks and how to settle it. When one
is answered it leaves this file — the answer becomes a `verified.md` row or a `map.md` edit.

---

### Q-07 · Do two clients on one container share THREAD state cleanly (laptop + phone)?

**Blocks** Whether "same project from laptop and phone" needs anything beyond two bearers.
**What is known** (2026-08-28, S0.9 laptop half, `verified.md`) The transport half is answered: two concurrent
pairings, two sockets, independent RPCs, no eviction. Untested: two clients driving the same thread
(one sends a turn, the other sees it; user-input cards answered from either side).
**How to answer** Owner-driven: the current web client on the laptop (`npm run dev:web`, port 5733,
`/pair?host=…&token=…`) and the POC mobile app on the phone, each with its own mint, on one thread.

---

### Q-08 · Does the VPN `instanceId` cleanly support the same user from several machines?

**Blocks** Whether a developer with a laptop and a desktop can both be connected to a project.
**Why unclear** `POST /project/{id}/vpn` takes an optional `instanceId` that appears to exist for
exactly this, but its semantics are not documented in any repo here.
**How to answer** Read the Zerops API spec, or register two keys with different `instanceId`s and
list the peers.

---

### Q-10 · Is the Turnstile captcha enforced on `POST /registration` at all, and is the site key hostname-bound?

**Blocks** Whether S4 can register a user from the z3 origin without a platform change (a captcha bound to the GUI's hostnames would be one).
**What is known** (2026-08-28, S0.7) The API's field validation does not list `token` as required (`{}` → `400` naming only `accountName`/`email`/`languageId`/`name`); the GUI always sends a solved Turnstile token; the site key is `0x4AAAAAABkfI4SNvJav8428` in the local environment. Nothing in any repo shows whether the backend verifies the token when present/absent or whether Cloudflare restricts the key to `app.zerops.io`.
**How to answer** The live registration run (Q-11) once with no `token`, once with a token solved on a foreign origin; both need throwaway e-mails from the owner. Never create accounts otherwise.

---

### Q-11 · Live registration + pool claim run

**Blocks** S4's "brand-new account reaches a thread" acceptance; confirms `zcpClaimed`, the timing until the claimed `zcp` is `ACTIVE`, and what `POST /registration` returns for a pool-aware signup.
**What is known** The exact request and the fallback calls are in `verified.md` S0.7; a ready-to-run curl sequence exists in the S0 report (`../zcp/plans/z3-s0-report-2026-08-28.md`).
**How to answer** Owner supplies throwaway e-mail addresses; run the sequence; record `zcpClaimed`, the project id, and the time to `ACTIVE` with direct reads. Waiting on the owner as of 2026-08-28.

---

### Q-12 · What happens when two containers holding the same copied Claude login both cross `expiresAt`?

**Blocks** How long the H-24 copied-login rig stays usable unattended, and whether S7's "one identity per container" premise has a hidden refresh-token race.
**What is known** (2026-08-28, S0.8) The access token lives ~8 h (`expiresAt` in `~/.claude/.credentials.json`); concurrent use inside that window by two containers caused no conflict and no refresh. Nothing was observed at or after expiry.
**How to answer** Leave a copy in a second throwaway container past `expiresAt`, run `claude -p` on both, diff the two credential files (`expiresAt`, mtime only — never contents) and see whether the second refresh is rejected.
