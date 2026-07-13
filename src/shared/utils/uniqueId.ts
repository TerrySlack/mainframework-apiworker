// utils/uniqueId.ts

/**
 * Generates a stable, unique string ID.
 * Uses crypto.randomUUID() when available (all modern browsers and Node 15+).
 * Falls back to a Math.random + timestamp combination for environments without crypto.
 */
export const uniqueId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
