import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";

/** Pill for a run / automation status (`running | succeeded | partial | failed | needs_input`). */
export function RunStatusBadge({ status }: { status: string | null | undefined }) {
  switch (status) {
    case "running":
      return (
        <Badge tone="accent" icon={<Spinner size={10} />}>
          Running
        </Badge>
      );
    case "succeeded":
    case "success":
      return <Badge tone="ok">Succeeded</Badge>;
    case "partial":
      return <Badge tone="warn">Partial</Badge>;
    case "failed":
    case "error":
      return <Badge tone="bad">Failed</Badge>;
    case "needs_input":
      return <Badge tone="accent">Needs input</Badge>;
    default:
      return <Badge tone="neutral">Not run yet</Badge>;
  }
}
