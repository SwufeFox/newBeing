import { notFound } from "next/navigation";
import { Terminal } from "@/components/terminal";
import { isRunId } from "@/lib/workspace-routes";

/**
 * A pasted run link opens Research with that result loaded. The shell reads the
 * same route id when it is already mounted, so opening a run from the rail is a
 * history entry rather than a navigation.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!isRunId(id)) notFound();
  return <Terminal routeWorkspace="research" routeRunId={id} />;
}
