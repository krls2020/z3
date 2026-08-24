import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  buildContainerUrl,
  categorizeService,
  fetchProjectOverview,
  ZeropsApiError,
  type ZeropsProjectOverview,
  type ZeropsService,
  type ZeropsServiceGroup,
  type ZeropsVerticalAutoscaling,
} from "~/zerops/api";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { StatusPill } from "./statusBadge";

const GROUP_SECTIONS: ReadonlyArray<{
  readonly key: ZeropsServiceGroup;
  readonly label: string;
  readonly defaultOpen: boolean;
}> = [
  { key: "runtimes", label: "Runtimes", defaultOpen: true },
  { key: "data", label: "Data", defaultOpen: true },
  // Build runtimes + project core are system/transient noise most of the time.
  { key: "infrastructure", label: "Infrastructure", defaultOpen: false },
];

function groupServices(
  services: ReadonlyArray<ZeropsService>,
): Record<ZeropsServiceGroup, ZeropsService[]> {
  const grouped: Record<ZeropsServiceGroup, ZeropsService[]> = {
    runtimes: [],
    data: [],
    infrastructure: [],
  };
  for (const service of services) {
    grouped[categorizeService(service)].push(service);
  }
  return grouped;
}

function formatResourceNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatRange(min: number, max: number): string {
  return `${formatResourceNumber(min)}–${formatResourceNumber(max)}`;
}

function ResourceBar({
  label,
  min,
  max,
}: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}) {
  const filled = max > 0 ? Math.min(100, (min / max) * 100) : 0;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" title={`${label}: ${min}–${max}`}>
      <span className="w-8 shrink-0 text-[10px] text-muted-foreground/70">{label}</span>
      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary/60" style={{ width: `${filled}%` }} />
      </span>
    </span>
  );
}

function ResourceEnvelope({ autoscaling }: { readonly autoscaling: ZeropsVerticalAutoscaling }) {
  const { minResource, maxResource } = autoscaling;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        CPU {formatRange(minResource.cpuCoreCount, maxResource.cpuCoreCount)} · RAM{" "}
        {formatRange(minResource.memoryGBytes, maxResource.memoryGBytes)} GB · Disk{" "}
        {formatRange(minResource.diskGBytes, maxResource.diskGBytes)} GB
      </span>
      <div className="flex items-center gap-3">
        <ResourceBar label="CPU" min={minResource.cpuCoreCount} max={maxResource.cpuCoreCount} />
        <ResourceBar label="RAM" min={minResource.memoryGBytes} max={maxResource.memoryGBytes} />
        <ResourceBar label="Disk" min={minResource.diskGBytes} max={maxResource.diskGBytes} />
      </div>
    </div>
  );
}

function ServiceCard({
  service,
  subdomainPrefix,
}: {
  readonly service: ZeropsService;
  readonly subdomainPrefix: string | undefined;
}) {
  const firstPort = service.ports[0]?.port;
  const openUrl =
    service.subdomainAccess && subdomainPrefix && firstPort
      ? buildContainerUrl(service.name, subdomainPrefix, firstPort)
      : null;
  const autoscaling = service.currentAutoscaling?.verticalAutoscaling;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{service.name}</span>
          <StatusPill status={service.status} />
        </div>
        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            Open ↗
          </a>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {service.serviceStackTypeInfo.serviceStackTypeName}
          {service.serviceStackTypeInfo.serviceStackTypeVersionName
            ? ` · ${service.serviceStackTypeInfo.serviceStackTypeVersionName}`
            : ""}
        </Badge>
        {service.ports.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            Ports {service.ports.map((port) => port.port).join(", ")}
          </span>
        ) : null}
      </div>
      {autoscaling ? (
        <div className="mt-2.5">
          <ResourceEnvelope autoscaling={autoscaling} />
        </div>
      ) : null}
    </div>
  );
}

function ServiceGroupSection({
  label,
  services,
  subdomainPrefix,
  defaultOpen,
}: {
  readonly label: string;
  readonly services: ReadonlyArray<ZeropsService>;
  readonly subdomainPrefix: string | undefined;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left">
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">({services.length})</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 pt-2 pb-1">
          {services.map((service) => (
            <ServiceCard key={service.id} service={service} subdomainPrefix={subdomainPrefix} />
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

type DetailState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "resolved"; readonly overview: ZeropsProjectOverview };

export function ZeropsProjectDetail({
  projectId,
  loadNonce,
}: {
  readonly projectId: string;
  readonly loadNonce: number;
}) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const isCancelled = () => generationRef.current !== generation;

    setState({ status: "loading" });

    void (async () => {
      try {
        const overview = await fetchProjectOverview(projectId);
        if (isCancelled()) return;
        setState({ status: "resolved", overview });
      } catch (error) {
        if (isCancelled()) return;
        const message =
          error instanceof ZeropsApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to load this project.";
        setState({ status: "error", message });
      }
    })();

    return () => {
      generationRef.current += 1;
    };
  }, [projectId, loadNonce]);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-1.5 px-1 py-6 text-sm text-muted-foreground">
        <Spinner className="size-3" />
        Loading project…
      </div>
    );
  }

  if (state.status === "error") {
    return <p className="px-1 py-6 text-sm text-destructive">{state.message}</p>;
  }

  const { overview } = state;
  const grouped = groupServices(overview.services);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <h2 className="truncate text-lg font-semibold text-foreground">{overview.name}</h2>
        <StatusPill status={overview.status} />
      </div>

      {overview.services.length === 0 ? (
        <p className="text-sm text-muted-foreground">This project has no services yet.</p>
      ) : (
        GROUP_SECTIONS.map(({ key, label, defaultOpen }) => {
          const services = grouped[key];
          if (services.length === 0) return null;
          return (
            <ServiceGroupSection
              key={key}
              label={label}
              services={services}
              subdomainPrefix={overview.subdomainPrefix}
              defaultOpen={defaultOpen}
            />
          );
        })
      )}
    </div>
  );
}
