import { notFound } from "next/navigation";
import { Terminal } from "@/components/terminal";
import { isWorkspaceSlug, SLUG_WORKSPACE } from "@/lib/workspace-routes";

/**
 * One dynamic segment holds all three views, so switching between them is a
 * re-render of the same page component rather than a remount: the chart, the
 * ticket and the docks keep their instances, which is what makes a tab click
 * feel instant. A static page per view would unmount the shell on every switch.
 */
export default async function WorkspacePage({ params }: { params: Promise<{ workspace: string }> }): Promise<React.JSX.Element> {
  const { workspace } = await params;
  if (!isWorkspaceSlug(workspace)) notFound();
  return <Terminal routeWorkspace={SLUG_WORKSPACE[workspace]} />;
}
