import type { ColorVisionMode } from "@/lib/preferences";

/**
 * Canvas series cannot read CSS custom properties, so the chart keeps its own
 * copy of the direction ramp. These values must stay in step with the
 * `:root[data-cv="deuteranopia"]` overrides in `globals.css`; both are the same
 * blue/orange pair so a candlestick and the PnL text beside it never disagree.
 */
export interface ChartPalette {
  up: string;
  down: string;
  upVolume: string;
  downVolume: string;
}

export const CHART_PALETTES: Record<ColorVisionMode, ChartPalette> = {
  default: {
    up: "#1fb180",
    down: "#ea525e",
    upVolume: "rgba(31, 177, 128, 0.32)",
    downVolume: "rgba(234, 82, 94, 0.32)",
  },
  deuteranopia: {
    up: "#3f8cff",
    down: "#ff9f45",
    upVolume: "rgba(63, 140, 255, 0.32)",
    downVolume: "rgba(255, 159, 69, 0.32)",
  },
};

export function chartPalette(mode: ColorVisionMode): ChartPalette {
  return CHART_PALETTES[mode];
}
