# z3

A control surface for coding agents that live **inside Zerops containers**.

Fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT). Upstream's own README is kept at
[`docs/upstream-README.md`](docs/upstream-README.md); their `LICENSE` and copyright notice are
untouched, as MIT requires.

---

## The idea in one paragraph

Every Zerops project already runs a `zcp` container: Ubuntu, a shell, the project's code, and
Claude Code + Codex already installed and authorised. So don't build an app that _talks to_ a
remote agent — **run the server in that container** and make the app a thin client. The agent
sits next to the code, file operations are local, work survives closing your laptop, and the same
client can hold several containers at once.

This is T3's own model, unchanged: _"Remoteness is expressed at the connection layer, never by
splitting the runtime."_ One running server = one environment. A Zerops project is just another
environment in the list, next to your local one.

```
  laptop / phone / browser                    zcp container (one per Zerops project)
 ┌──────────────────────────┐                ┌────────────────────────────────────┐
 │  z3 client               │   wss over     │  z3 server                         │
 │  threads, approvals,     │◄──────────────►│  spawns `claude`  ──► zcp MCP      │
 │  diffs, terminal         │  public HTTPS  │  /var/www, git, terminal — local   │
 └──────────────────────────┘   (no VPN)     └────────────────────────────────────┘
```

**Why the agent belongs in the container, not on your laptop:** it is next to the code (no
remoting every file read), it keeps working when you close the lid, and it has the platform in
its hands — the `zerops_*` MCP tools (deploy, logs, import, scale, env, subdomain…). A local
agent orchestrating a remote one would mean two LLM loops in series: double the cost and latency,
and a telephone game when something goes wrong.

---

## What was verified live

Measured against a real `zcp` container, not assumed:

| Fact                                      | Result                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Node in the container                     | v24.16 / v24.18 — server needs ^24.13, already there                           |
| Agents installed                          | `claude` 2.1.241, `codex` 0.139.0                                              |
| Headless `claude -p` in container         | works (this is how the server drives it)                                       |
| `zerops_*` MCP tools from headless claude | works — `zerops_discover` returned the project name                            |
| Public HTTPS per container                | HTTP/2, 86 ms, TLS at the Zerops L7                                            |
| WebSocket upgrade                         | already in zcp's nginx template                                                |
| Auth chain                                | pairing credential → RFC 8693 token exchange → 30-day bearer → 5-min WS ticket |
| Zerops API from a browser                 | `access-control-allow-origin: *` — no proxy, no server change needed           |
| Server footprint in container             | ~110 MB (2 GB box; wants 4 GB with an agent running)                           |

**Not verified:** the Connect round-trip end to end, and long-term behaviour of a big repo on an
sshfs-mounted workspace (see Known gaps).

---

## What is Zerops-specific here

Be clear about the split — most of this repo is upstream T3.

**In the client (this fork):**

- `/zerops` — a page listing every project across all your orgs, and for one project its services
  grouped by kind: Runtimes, Data (managed databases + object storage), Infrastructure (core and
  build runtimes, collapsed). Per service: type and version, status, ports, an Open link where a
  subdomain is on, and the autoscaling envelope (CPU/RAM/disk min–max).
- Settings → Zerops — your Zerops token, and connecting a project's `zcp` container as an
  environment (the container URL is derived, you don't hunt for it).
- Branding: a `zerops` built-in theme, logo, product name.

**In the container (pre-existing zcp, not built here):** the actual leverage — the agent's
`zerops_*` MCP toolset. That is what makes this different from any other agent GUI, and it is not
part of this repo.

---

## How things are solved

**Container URL derivation.** `https://{service}-{prefix}-{port}.prg1.zerops.app`, where `prefix`
is the project's `zeropsSubdomainHost`. Verified working. Caveat: that field returns a **bare
prefix** (`"2333"`) with no domain, so the region is currently hardcoded to `prg1`. zcp itself
reads the real URL from the service env for exactly this reason — anything beyond a POC should do
the same.

**Org resolution.** `/user/info` has **no top-level `clientId`**. Membership lives in
`clientUserList`, and a user can belong to several orgs — in testing, the first org held zero
projects, so picking `[0]` looks like an empty account. `fetchAllProjects()` reads every
membership and merges, tagging each project with its org.

**Token handling.** The Zerops token lives in `localStorage` (`zerops:api-token`), browser-local,
sent only to the Zerops API. It is **subscribed, not sampled**: you enter it in Settings and reach
`/zerops` by client-side navigation, so a mount-time read would show "no token" until a hard
reload.

**No topology graph.** `connectedStacks` comes back empty on every service, so dependency edges
would be invented. Grouping and resources are real API data; relationships are not, so they are
not drawn. Services with no autoscaling block render no bar rather than an empty one.

**Pairing is a deliberate step.** Connecting a container still needs a one-time pairing code
minted on that container. Auto-minting it would let anyone past the zcp gate claim agent access —
that is a hole, not a convenience. It needs container-side support to be safe.

**Theme as an addition, not an overwrite.** `ZEROPS_THEME` is registered alongside the upstream
built-ins rather than replacing one. Two things that are easy to miss: `--primary` (filled
buttons) maps from the `messageAction` role, not `accent`; and `index.html` keeps a hand-written
mirror of the palettes for the pre-React paint, which must list the theme too or a cold load
flashes the wrong ground.

**Contrast is measured, not eyeballed.** White on the brand teal `#00b1a3` is 2.61:1 — below WCAG
AA. The light action shade is deepened to `#007e72` (4.82:1). Dark mode measures 10.89:1. Body,
muted and sidebar text pass AA in both.

---

## Running it

**Client (local dev):**

```bash
nvm use 24.19.0                       # server needs ^24.13.1
curl -fsSL https://vite.plus | bash   # once, installs `vp`
vp i
vp run dev                            # server :13773, web :5733
```

Open the pairing URL the server prints. **Use `localhost`, not `127.0.0.1`** — vite binds IPv6
only, so the IPv4 address refuses the connection.

**Server in a zcp container:**

```bash
ssh zerops@zcp                        # over the project VPN
npx t3@latest serve --host 127.0.0.1 --port 3773 --base-dir "$HOME/.t3poc"
```

Reach it either through an SSH tunnel (`poc/pair.sh` opens one and mints a pairing code), or
publicly by pointing the container's nginx `proxy_pass` at `127.0.0.1:3773` — the template already
handles WebSocket upgrade and keeps its cookie gate in front. Note that this takes over the
code-server URL; `zcp init` restores it.

---

## Known gaps

- **Connect round-trip** not exercised end to end.
- **sshfs workspaces.** The zcp flow mounts other services into `/var/www` over sshfs. Every turn
  is bracketed by a git checkpoint on the workspace root, and git over sshfs is slow — so a
  project root must be a real local directory (`/var/www/app`), never a mount, and mounts should
  stay outside it. Measured on a trivial repo only (8 files, 60 ms); a real repo will differ.
- **Cost.** A project is reachable only while its container runs. Scale-to-minimum plus wake-on-
  connect is the obvious answer and is not built.
- **Thread history** lives in the container. If it is rebuilt, history goes with it.
- **Region** hardcoded to `prg1`.
- **Not renamed on purpose:** the `t3code:` localStorage prefix (~35 keys — renaming drops every
  user's saved theme, settings and drafts without a migration) and the `t3code://` URL scheme
  (registered with Clerk for OAuth callbacks — an external coordination step).
- **App icons** are generated from macOS Icon Composer projects and the `.icns` export is not
  scriptable; the web favicon is an SVG, so only desktop packaging needs a human.

---

## Fork discipline

Upstream moves fast. Changes here are deliberately **additive** so a rebase stays possible:

- a new built-in theme, not an edited one
- new files for new features
- existing files touched only where a registry needs one line (routes, settings nav, sidebar)

The one place worth respecting: T3 has a named extension point,
`AdvertisedEndpointProvider` (~150 lines, Tailscale is its first implementation). A proper Zerops
endpoint provider belongs there rather than in bespoke wiring. `infra/relay` — upstream's
Cloudflare tunnel — is dead weight here: Zerops containers are not behind NAT, they already have
public HTTPS.

```bash
git remote -v          # origin = this repo, upstream = pingdotgg/t3code
git fetch upstream && git rebase upstream/main
```

`poc/` holds the scripts used to apply these changes plus `pair.sh`; they are throwaway, kept only
so the edits are reproducible.
