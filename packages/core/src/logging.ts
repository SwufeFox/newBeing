export type LogLevel = "info" | "warn" | "error";

export function logEvent(level: LogLevel, event: string, details: Record<string, string | number | boolean | null> = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: "newbeing",
    event,
    ...details,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
