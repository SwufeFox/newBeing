"use client";

import { useSyncExternalStore } from "react";

/**
 * Local presentation preferences.
 *
 * These are deliberately *not* part of the workspace store: that slice is
 * persisted through the SQLite workspace API so every surface (MCP, server
 * routes, other tabs) agrees on the selected market. A language or a colour
 * scheme is a property of this display, not of the research workspace, and it
 * must survive without a server round trip.
 */

export type UiLocale = "en" | "zh";

/**
 * `deuteranopia` swaps the red/green direction ramp for blue/orange, the pair
 * that stays separable for the most common colour-vision deficiencies. It is a
 * colour aid only: direction is still carried by arrows, labels and sign.
 */
export type ColorVisionMode = "default" | "deuteranopia";

export interface UiPreferences {
  locale: UiLocale;
  colorVision: ColorVisionMode;
}

export const DEFAULT_PREFERENCES: UiPreferences = { locale: "en", colorVision: "default" };

const STORAGE_KEY = "newbeing:ui-preferences:v1";

function isLocale(value: unknown): value is UiLocale {
  return value === "en" || value === "zh";
}

function isColorVision(value: unknown): value is ColorVisionMode {
  return value === "default" || value === "deuteranopia";
}

let current: UiPreferences | null = null;
let hooksInstalled = false;
const listeners = new Set<() => void>();

function readStored(): UiPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFERENCES;
    const locale = "locale" in parsed && isLocale(parsed.locale) ? parsed.locale : DEFAULT_PREFERENCES.locale;
    const colorVision = "colorVision" in parsed && isColorVision(parsed.colorVision)
      ? parsed.colorVision
      : DEFAULT_PREFERENCES.colorVision;
    return { locale, colorVision };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Reflect the preference on the root element instead of on application state:
 * `data-cv` lets the token layer repaint every direction cue at once, and `lang`
 * tells screen readers which language the copy is actually in.
 */
function apply(preferences: UiPreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.cv = preferences.colorVision;
  root.lang = preferences.locale === "zh" ? "zh-CN" : "en";
}

export function getPreferences(): UiPreferences {
  if (current === null) {
    current = readStored();
    apply(current);
  }
  if (!hooksInstalled && typeof window !== "undefined") {
    hooksInstalled = true;
    /* Another tab may change the language or the colour mode. Without this the
       second tab keeps rendering the previous copy until it is reloaded. */
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      const next = readStored();
      if (next.locale === current?.locale && next.colorVision === current?.colorVision) return;
      current = next;
      apply(next);
      for (const listener of listeners) listener();
    });
  }
  return current;
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPreferences(patch: Partial<UiPreferences>): void {
  const next = { ...getPreferences(), ...patch };
  if (next.locale === current?.locale && next.colorVision === current?.colorVision) return;
  current = next;
  apply(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled localStorage must not break the settings dialog.
  }
  for (const listener of listeners) listener();
}

/** One constant reference: `useSyncExternalStore` requires a stable server
 *  snapshot or React re-reads it on every render and warns about churn. */
function getServerSnapshot(): UiPreferences {
  return DEFAULT_PREFERENCES;
}

export function usePreferences(): UiPreferences {
  return useSyncExternalStore(subscribePreferences, getPreferences, getServerSnapshot);
}

export function getLocale(): UiLocale {
  return getPreferences().locale;
}
