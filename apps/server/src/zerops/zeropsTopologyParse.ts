/**
 * Parses the JSON document `zcp studio topology` prints into the service map's
 * contract shape.
 *
 * The document is `ops.DiscoverResult` (`cmd/zcp/studio.go:110-142`) — a direct,
 * lag-free read of the project's services, not the Elasticsearch-backed search.
 * Every field the map renders comes from zcp: `mountPath` is zcp's own answer to
 * "is this service mounted" (`internal/tools/discover.go:127-132`), so the
 * client never has to guess a mount from a directory listing the way the POC
 * did. There is no live build/deploy state on this path.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, type ZeropsProject, type ZeropsService } from "@t3tools/contracts";

import { isSettledZeropsStatus, zeropsServiceGroup } from "./zeropsServiceTaxonomy.ts";

export interface ZeropsTopologyRead {
  readonly project: ZeropsProject;
  readonly services: ReadonlyArray<ZeropsService>;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Only the four fields Go always emits are required. `adoptionState` and
 * `isInfrastructure` default rather than reject: losing every service because
 * one classification field moved would be a much worse failure than showing a
 * service with a weaker classification.
 */
const RawService = Schema.Struct({
  hostname: Schema.String.check(Schema.isNonEmpty()),
  serviceId: Schema.String,
  type: Schema.String,
  status: Schema.String,
  adoptionState: Schema.optional(Schema.String),
  isInfrastructure: Schema.optional(Schema.Boolean),
  mountPath: Schema.optional(Schema.String),
  subdomainEnabled: Schema.optional(Schema.Boolean),
  subdomainUrl: Schema.optional(Schema.String),
});

/**
 * `services` and `warnings` are `NullOr` because Go marshals a nil slice as
 * `null`, not `[]` — a project with nothing in it emits `"services": null`.
 */
const RawTopology = Schema.Struct({
  project: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    status: Schema.optional(Schema.String),
  }),
  services: Schema.NullOr(ForwardCompatibleArray(RawService)),
  warnings: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});

const decodeTopology = Schema.decodeUnknownOption(RawTopology);

const toService = (raw: typeof RawService.Type): ZeropsService => {
  const isManagedService = raw.isInfrastructure ?? false;
  const adoptionState = raw.adoptionState ?? "";
  return {
    hostname: raw.hostname,
    serviceId: raw.serviceId,
    type: raw.type,
    status: raw.status,
    group: zeropsServiceGroup({ type: raw.type, adoptionState, isManagedService }),
    adoptionState,
    isManagedService,
    transient: !isSettledZeropsStatus(raw.status),
    mounted: raw.mountPath !== undefined && raw.mountPath !== "",
    ...(raw.mountPath !== undefined && raw.mountPath !== "" ? { mountPath: raw.mountPath } : {}),
    ...(raw.subdomainEnabled !== undefined ? { subdomainEnabled: raw.subdomainEnabled } : {}),
    ...(raw.subdomainUrl !== undefined ? { subdomainUrl: raw.subdomainUrl } : {}),
  };
};

/**
 * The topology a `zcp studio topology` run produced, or undefined when the
 * output is not one — which is how a diagnostic printed on stdout, a truncated
 * read, or an older zcp reaches the caller. The caller decides what an
 * unreadable answer means; this function never throws.
 */
export const parseZeropsTopology = (text: string): ZeropsTopologyRead | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const decoded = Option.getOrUndefined(decodeTopology(parsed));
  if (decoded === undefined) {
    return undefined;
  }
  return {
    project: decoded.project,
    services: (decoded.services ?? []).map(toService),
    warnings: decoded.warnings ?? [],
  };
};
