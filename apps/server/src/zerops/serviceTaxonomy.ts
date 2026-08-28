/**
 * Classification of Zerops services for the service map.
 *
 * The POC grouped services on the Zerops API's `serviceStackTypeCategory`
 * (USER → runtimes, STANDARD/OBJECT_STORAGE → data, else infrastructure).
 * `zcp studio topology` does not carry that field, so the same three groups are
 * rebuilt from what it does carry — `adoptionState`, `type`, and the
 * `isInfrastructure` flag, which zcp computes as `topology.IsManagedService`
 * (`internal/ops/discover.go:261`) and therefore means "managed data service",
 * not "infrastructure".
 */
import { SETTLED_ZEROPS_SERVICE_STATUSES, type ZeropsServiceGroup } from "@t3tools/contracts";

const ZCP_ADOPTION_STATE = "zcp-self";
const ZCP_TYPE_PREFIX = "zcp";

/**
 * The platform reports some statuses in both a bare and a `SERVICE_`-prefixed
 * spelling (`serviceStackStatusEnum.go`); one settled set serves both.
 */
const SERVICE_STATUS_PREFIX = "SERVICE_";

const settled: ReadonlySet<string> = new Set(SETTLED_ZEROPS_SERVICE_STATUSES);

/**
 * Whether a service has stopped moving.
 *
 * Defined by an allow-list of settled statuses, so anything unrecognised counts
 * as transient. A status the platform adds later then costs one extra poll,
 * whereas the inverse default would leave a service frozen mid-transition on
 * screen with nothing to un-freeze it — the topology doorbell fires on service
 * add/delete only, never on a status change.
 */
export const isSettledZeropsStatus = (status: string): boolean => {
  const normalized = status.startsWith(SERVICE_STATUS_PREFIX)
    ? status.slice(SERVICE_STATUS_PREFIX.length)
    : status;
  return settled.has(normalized);
};

/**
 * Which panel of the service map a service belongs in.
 *
 * Order matters: the zcp container is a managed-by-Zerops runtime type, so it
 * has to be claimed as infrastructure before the runtime branch sees it.
 */
export const zeropsServiceGroup = (service: {
  readonly type: string;
  readonly adoptionState: string;
  readonly isManagedService: boolean;
}): ZeropsServiceGroup => {
  if (
    service.adoptionState === ZCP_ADOPTION_STATE ||
    service.type.toLowerCase().startsWith(ZCP_TYPE_PREFIX)
  ) {
    return "infrastructure";
  }
  return service.isManagedService ? "data" : "runtimes";
};
