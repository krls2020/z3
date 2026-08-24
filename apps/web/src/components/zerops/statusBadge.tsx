import { Badge } from "../ui/badge";

// Mirrors the Badge component's own color variants so the Zerops status pill
// palette stays tied to the app's semantic tokens instead of one-off hex values.
type StatusPillVariant = "success" | "info" | "warning" | "error" | "secondary";

export function statusBadgeVariant(status: string): StatusPillVariant {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "READY_TO_DEPLOY":
    case "NEW":
    case "CREATING":
      return "info";
    case "STOPPING":
    case "STOPPED":
      return "warning";
    case "FAILED":
    case "DELETING":
      return "error";
    default:
      return "secondary";
  }
}

export function StatusPill({ status }: { readonly status: string }) {
  return (
    <Badge variant={statusBadgeVariant(status)} className="font-normal">
      {status}
    </Badge>
  );
}
