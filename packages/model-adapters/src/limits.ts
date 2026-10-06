/** Step budget for model loops. Override with WORKSTATE_MAX_STEPS. */
export function maxSteps(fallback = 40): number {
  const raw = Number(process.env.WORKSTATE_MAX_STEPS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function isFinish(result: unknown): result is { finish: true; text?: string; artifacts?: string[] } {
  return Boolean(result && typeof result === "object" && "finish" in result && (result as { finish?: boolean }).finish);
}

export function errorPayload(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}
