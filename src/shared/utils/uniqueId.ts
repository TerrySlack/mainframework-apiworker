// utils/uniqueId.ts
let idCounter = 0;

/**
 * Generates a stable, unique string ID.
 * SSR-safe and works in any environment.
 */
export const uniqueId = (): string => {
  idCounter += 1;
  return idCounter.toString();
};
