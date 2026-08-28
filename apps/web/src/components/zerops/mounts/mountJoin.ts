import type { FilesystemBrowseEntry } from "@t3tools/contracts";

import type { ZeropsService } from "~/zerops/api";

export interface ZeropsMountRow {
  readonly name: string;
  readonly fullPath: string;
  /** `null` when no sibling service's hostname matches this mount's name — `zcp` has no reserved-name list, so an unmatched entry is still shown, never dropped. */
  readonly service: ZeropsService | null;
}

/**
 * Joins `/var/www` directory entries (from the filesystem-browse atom) to
 * this project's sibling services by hostname — `zcp` sshfs-mounts each
 * sibling at `/var/www/<hostname>` from that service's own `/var/www`
 * (`docs/internals/zerops/map.md`). The project's own workspace root is not
 * a mount and is excluded, never rendered as one (`hacks.md` H-14).
 */
export function joinVarWwwMounts(
  entries: ReadonlyArray<FilesystemBrowseEntry>,
  services: ReadonlyArray<ZeropsService>,
  workspaceRoot: string | null,
): ReadonlyArray<ZeropsMountRow> {
  const serviceByHostname = new Map(services.map((service) => [service.name, service]));
  return entries
    .filter((entry) => entry.fullPath !== workspaceRoot)
    .map((entry) => ({
      name: entry.name,
      fullPath: entry.fullPath,
      service: serviceByHostname.get(entry.name) ?? null,
    }));
}
