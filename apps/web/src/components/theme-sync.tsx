"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/store/workspace";

/** Apply the persisted theme on every route, not only the terminal page. */
export function ThemeSync(): null {
  const theme = useWorkspaceStore((state) => state.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
}
