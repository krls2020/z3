# Open questions

Unknowns that block a real implementation. Each says what it blocks and how to settle it. When one
is answered it leaves this file — the answer becomes a `verified.md` row or a `map.md` edit.

---

### Q-01 · Does a dynamically created `zsc` unit survive a container restart?

**Blocks** Whether z3 can be registered once and forgotten, or must be re-established at every boot.
**What is known** On `eval`, `zerops@sshfs-app.service` is a real systemd unit on the rootfs with
`UnitFileState=enabled`, and it was created dynamically — `ZCP_SSHFS_HOSTNAMES` is unset there. That
is everything needed to survive, _if_ the rootfs does. But the container has been up 13 days, so no
restart has ever tested it.
**Largely moot either way** The service YAML has a `startCommands` list, which is how zcp's own nginx
and code-server are supervised. Declaring z3 there is durable by construction and needs no answer to
this question. Worth settling anyway, because it decides whether anything created at runtime can be
trusted to come back.
**How to answer** `POST /service-stack/{id}/restart`, then check the unit. **Blocked on a human:**
the `eval` container hosts a live agent session and a manually started z3 on `127.0.0.1:3773`, and
neither would come back.

---

### Q-05 · How slow is git checkpointing on a real repo in a container?

**Blocks** Whether the per-turn checkpoint is viable at all for real projects, or whether it needs
to become optional.
**Why unclear** Only measured on a trivial repo — 8 files, 60 ms.
**How to answer** Clone something realistic into `/var/www/app` on a test container and time a few
turns. Do it with mounts present but outside the root, since that is the intended layout.

---

### Q-07 · What happens when two clients pair to the same container?

**Blocks** Whether "switch between projects" and "same project from laptop and phone" are the same
feature or two.
**Why unclear** Untested. Each pairing mints its own bearer, but whether the server, thread state
and terminal sessions tolerate two live clients is unknown.
**How to answer** Pair twice against one container and drive both.

---

### Q-08 · Does the VPN `instanceId` cleanly support the same user from several machines?

**Blocks** Whether a developer with a laptop and a desktop can both be connected to a project.
**Why unclear** `POST /project/{id}/vpn` takes an optional `instanceId` that appears to exist for
exactly this, but its semantics are not documented in any repo here.
**How to answer** Read the Zerops API spec, or register two keys with different `instanceId`s and
list the peers.
