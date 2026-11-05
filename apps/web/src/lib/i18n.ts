"use client";

import { getLocale, usePreferences, type UiLocale } from "@/lib/preferences";

/**
 * Message tables are declared next to the surface that renders them, not in one
 * central catalog: a component owns its own copy, so adding a translation file
 * cannot collide with another one and a reviewer sees both languages together.
 *
 * Every table must carry the *same* shape, which `CopyTable` enforces. The
 * English side is the identity translation of the existing strings, so the
 * default locale renders exactly what the app rendered before i18n existed.
 */
export type CopyTable<T> = Record<UiLocale, T>;

export function selectCopy<T>(locale: UiLocale, table: CopyTable<T>): T {
  return table[locale];
}

export function useCopy<T>(table: CopyTable<T>): T {
  return selectCopy(usePreferences().locale, table);
}

export function useLocale(): UiLocale {
  return usePreferences().locale;
}

/** For callbacks and imperative handlers that run outside render. */
export function translate<T>(table: CopyTable<T>): T {
  return selectCopy(getLocale(), table);
}
