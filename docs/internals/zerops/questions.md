# Open questions

Unknowns that block a real implementation. Each says what it blocks and how to settle it. When one
is answered it leaves this file — the answer becomes a `verified.md` row or a `map.md` edit.

---

### Q-08 · Does the VPN `instanceId` cleanly support the same user from several machines?

**Blocks** Whether a developer with a laptop and a desktop can both be connected to a project.
**Why unclear** `POST /project/{id}/vpn` takes an optional `instanceId` that appears to exist for
exactly this, but its semantics are not documented in any repo here.
**How to answer** Read the Zerops API spec, or register two keys with different `instanceId`s and
list the peers.

---

### Q-11 · Live registration + pool claim run

**Blocks** S4's "brand-new account reaches a thread" acceptance; confirms `zcpClaimed`, the timing until the claimed `zcp` is `ACTIVE`, and what `POST /registration` returns for a pool-aware signup.
**What is known** The exact request and the fallback calls are in `verified.md` S0.7. Registration cannot be driven from a foreign origin (Q-10, answered: the Turnstile key is hostname-bound), so the live run goes through the real GUI (`app.zerops.io/registration?zcp=true`, puppeteer) and measures the claim from the API afterwards — running 2026-08-28.
**How to answer** Owner supplies throwaway e-mail addresses; run the sequence; record `zcpClaimed`, the project id, and the time to `ACTIVE` with direct reads. Waiting on the owner as of 2026-08-28.

---

### Q-12 · What happens when two containers holding the same copied Claude login both cross `expiresAt`?

**Blocks** How long the H-24 copied-login rig stays usable unattended, and whether S7's "one identity per container" premise has a hidden refresh-token race.
**What is known** (2026-08-28, S0.8) The access token lives ~8 h (`expiresAt` in `~/.claude/.credentials.json`); concurrent use inside that window by two containers caused no conflict and no refresh. Nothing was observed at or after expiry.
**How to answer** Leave a copy in a second throwaway container past `expiresAt`, run `claude -p` on both, diff the two credential files (`expiresAt`, mtime only — never contents) and see whether the second refresh is rejected.

---

### Q-13 · Why does the web GUI's "Add project" dialog hang on "Connecting…" against a loopback-bound server behind a tunnel/proxy?

**Blocks** Nothing on the product path (S2 auto-bootstraps the `/var/www` project and S4 never opens that dialog), but it may be the first symptom of the `loopback-browser` mis-classification (S0.9 web half) hitting a UI flow.
**What is known** (2026-08-28) `server.probe`, `server.getConfig`, `orchestration.dispatchCommand` over the same bearer answer instantly; only the folder-browse dialog never resolves (~40 s). Server started with `--host 127.0.0.1`, reached through an SSH tunnel.
**How to answer** Reproduce once S1's policy override is in (remote-reachable in Zerops mode); if it persists, trace the dialog's RPC (`filesystem.browse`?) in the browser's WS frames.
