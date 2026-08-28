# Zerops integration — field notes

Groundwork for running the z3 server inside a Zerops `zcp` container and driving it from the
z3 client. Written during POC work, kept because the POC is deliberately hacky and the real
implementation needs to know what was faked and why.

**Scope right now: the web app.** Mobile and VPN-on-mobile are explicitly out — mobile will
reach containers over plain HTTPS later, which is a different problem with different answers.

## The four files

| File                           | Holds                                      | Lifecycle                                                    |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| [`map.md`](map.md)             | The systems and every channel between them | Changes when a channel is added or removed                   |
| [`verified.md`](verified.md)   | Facts measured against real systems        | Each entry decays; re-verify before trusting                 |
| [`hacks.md`](hacks.md)         | POC shortcuts and what the real fix is     | Entries die when paid back                                   |
| [`questions.md`](questions.md) | Unknowns that block real implementation    | Entries die when answered — move the answer to `verified.md` |

## Rules for adding to this

- **Date every fact and say how it was measured.** A claim with no date is a rumour six weeks
  later. Prefer a command someone can re-run over a sentence they have to trust.
- **A hack is only a hack if it is written down.** Anything knowingly wrong, temporary, or
  papered over goes in `hacks.md` the moment it is done, not at the end.
- **Answered questions leave `questions.md`.** They become a `verified.md` entry or a `map.md`
  edit. The file should shrink as the work proceeds.
- **One fact per entry.** Do not write paragraphs. This is a reference, not a narrative.
- **No plans here.** Plans live in the issue or PR that owns the work (see `AGENTS.md`).

## Repos this touches

| Repo              | What it is                                                         | Path                 | Read it at                                      |
| ----------------- | ------------------------------------------------------------------ | -------------------- | ----------------------------------------------- |
| `zerops-code`     | This fork — z3 client + server                                     | .                    | `zerops-poc`                                    |
| `zcp`             | The Go MCP server and init that runs inside the container          | `../zcp`             | **`feat/z3-container`**, not `main` — see below |
| `zcli`            | The user's laptop CLI — VPN, project/service ops, zcp SSH sessions | `../zcli`            | `main`; the VPN spec is on `kh-zcp-multi-vpn`   |
| `frontend-legacy` | The official Zerops web app — reference for auth flows             | `../frontend-legacy` | `main`                                          |

`zcp@1` — the container base image itself — is platform-owned and lives in none of these.

### The `zcp` half is parked on a branch

Every `zcp` path these notes cite — the `/z3-pair` and `/healthz` locations in
`internal/content/templates/nginx.conf.tmpl`, `internal/z3`, `internal/z3sidecar`,
`cmd/zcp/z3sidecar.go`, the `z3`/`z3sidecar` entries in `internal/service/service.go`, the
workspace step and init-complete marker in `internal/init`, and `deploy/zcp-container.yml` —
exists **only** on branch `feat/z3-container` (`7c98c793`, 2026-08-27, local-only, never
pushed). On `zcp` `main` none of those paths exist, so a path lookup there returns nothing and
reads as "never built". Check the branch out before reading any of them.

Parked, not abandoned: it builds, `go test ./... -short` and `make lint-fast` are green, and it
was live-verified against `z3probe` including a genuine service restart. What it lacks is a
`docs/spec-*.md` section in `zcp` — that repo's rule is that a design decision is not landed
until it is promoted out of a plan into a spec, and no spec covers z3. Whoever resumes this
should expect the branch to have been rebased, renamed, or merged in the meantime; confirm the
name with `git -C ../zcp branch --list '*z3*'` before trusting it.
