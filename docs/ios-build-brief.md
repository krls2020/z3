# Brief: build the mobile app onto a physical iPhone

For an agent picking this up cold. Read [`../README.md`](../README.md) first for what this fork is.

**Repo:** `/Users/macbook/Documents/Zerops-MCP/zerops-code` · branch `zerops-poc` (tracks
`origin/main` = `git@github.com:krls2020/z3.git`)
**App:** `apps/mobile` — Expo / React Native, package `@t3tools/mobile`, Expo SDK-managed (no
`ios/` dir checked in; `expo prebuild` generates it).

---

## Read this before running anything

Four things will stop you. They are all resolvable, but not by guessing.

**1. Xcode is installed but not selected.** `/Applications/Xcode.app` exists, yet
`xcode-select -p` points at `/Library/Developer/CommandLineTools`. Native builds need full Xcode:

```bash
sudo xcode-select -s /Applications/Xcode.app     # needs the user's sudo — ask, do not assume
xcodebuild -version                              # verify before continuing
```

**2. CocoaPods is not installed.** `expo prebuild` for iOS needs it (`brew install cocoapods`).

**3. Do not use EAS.** `apps/mobile/app.config.ts` has `owner: "pingdotgg"` and
`extra.eas.projectId: "d763fcb8-…"` — that Expo project belongs to upstream, not to us. Every
`eas build` script in `package.json` will fail or push to someone else's project. `eas-cli` is not
installed either. **Build locally** (`expo run:ios`).

**4. The bundle identifiers are not ours.** The variants declare `com.t3tools.t3code[.dev]` and
`associatedDomains` for `clerk.t3.codes`. You cannot sign those with our Apple ID.

---

## The sanctioned route: personal-team build

Upstream already built an escape hatch for exactly this — a free-Apple-ID build with your own
bundle id. Use it rather than editing `app.config.ts`.

Create `.env` at the **repo root** (gitignored; `app.config.ts` reads it via `loadRepoEnv`, which
merges `.env` and `.env.local`):

```bash
T3CODE_IOS_PERSONAL_TEAM=1
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=cz.krls.z3      # any reverse-DNS you control
T3CODE_IOS_PERSONAL_TEAM_ID=YOURTEAMID             # optional; keeps signing across clean prebuilds
```

The config validates this: with `T3CODE_IOS_PERSONAL_TEAM=1` and a missing or malformed id it
throws with the reason. The id then replaces `iosBundleIdentifier` for whichever variant you build.

Then:

```bash
nvm use 24.19.0                                   # repo requires node ^24.13.1
export PATH="$HOME/.local/share/vite-plus/bin:$PATH"
vp i                                              # already done once in this checkout
cd apps/mobile
APP_VARIANT=development EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform ios
npx expo run:ios --device                         # pick the connected iPhone
```

`package.json` also has `ios:dev` / `ios:preview` / `ios:prod` wrappers that do prebuild + run in
one step. Variants: `development` (scheme `t3code-dev`), `preview`, `production`.

First run on a device also needs, in Xcode: a signing team (free Apple ID works), and on the phone
**Settings → General → VPN & Device Management → trust the developer certificate**. A free
personal team certificate expires after 7 days — the app then stops launching until rebuilt.

---

## What this app actually is — do not expect it to work alone

The mobile app is a **client**. It has no agent and no server in it; it connects over WebSocket to
a running server and drives whatever that server owns. So a successful build shows a pairing
screen, nothing more, until you point it at a server.

Two servers you can point it at:

- **The Zerops container (the interesting one).** Public HTTPS, reachable from a phone on cellular
  with no VPN: `https://zcp-2333-8080.prg1.zerops.app` (eval project). Zerops exposes nginx's
  service port **8080** through its HTTPS L7; T3 stays private on `127.0.0.1:3773` and must not be
  opened directly.
- **The local dev server.** `vp run dev` at the repo root, web on `:5733`, server on `:13773` —
  LAN only, and the phone must be on the same network. Note the dev web server binds **IPv6
  loopback only**, so a LAN URL needs the server, not the vite port.

The eval nginx keeps browser `/` behind the ZCP cookie login. Only T3's authenticated transport
routes are public: `/.well-known/`, `/oauth/`, `/api/`, and `/ws`. Pairing/session tokens and
short-lived WebSocket tickets still enforce access on those routes.

Pairing needs a one-time code minted on that server. For the public mobile route:

```bash
PUBLIC_ORIGIN=https://zcp-2333-8080.prg1.zerops.app ./poc/pair.sh
```

Enter the printed host and one-time code in Zerops Code. Omit `PUBLIC_ORIGIN` to retain the old
local SSH-tunnel flow on port 3888. The eval nginx change currently lives in the running container,
so a container rebuild must carry the same location rules into its managed nginx template.

---

## Mobile branding in this fork

The mobile client ships as **Zerops Code** across its production, preview, and development
variants. It uses the official two-tone Zerops mark in navigation and loading surfaces, Zerops
accent colors in the upgrade-safe default mobile theme, and dedicated source assets under
`apps/mobile/assets/zerops/` for iOS, Android, splash, notification, and monochrome icons.

Internal compatibility identifiers remain upstream-shaped where they carry state or callback
compatibility: the `t3code://` URL schemes, Expo slug, and persisted storage/theme IDs do not change.
Generated native targets follow the visible Zerops Code variant name.

---

## Ground rules

- **Additive changes only.** This is a fork that must stay rebasable on `upstream/main`. Prefer
  `.env` and new files over editing `app.config.ts`.
- **Never rename** the `t3code://` URL schemes casually — the dev client launches through
  `t3code-dev`, and the scheme is also registered with Clerk for OAuth callbacks.
- **Do not commit `.env`** (already gitignored) or any signing asset.
- Report honestly what you did not verify. A build that compiles is not a build that launched on
  the phone, and a launch is not a paired session.
