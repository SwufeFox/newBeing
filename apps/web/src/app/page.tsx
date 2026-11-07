import { redirect } from "next/navigation";
import { WORKSPACE_PATH } from "@/lib/workspace-routes";

/** The shell has three views and each has its own URL; the root is an alias. */
export default function Home(): never {
  redirect(WORKSPACE_PATH.terminal);
}
