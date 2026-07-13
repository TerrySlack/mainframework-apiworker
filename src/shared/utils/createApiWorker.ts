/**
 * Creates a Worker instance for the API request worker.
 * Use this for vanilla JS/TS or to build your own framework integration.
 */
export const createApiWorker = (): Worker =>
  new Worker(new URL("../workers/api/api.worker.js", import.meta.url), { type: "module" });
