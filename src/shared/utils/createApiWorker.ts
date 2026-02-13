function getWorkerUrl(): string {
  return new URL("./api.worker.js", import.meta.url).href;
}

/**
 * Creates a Worker instance for the API request worker.
 * Use this for vanilla JS/TS or to build your own framework integration.
 */
export function createApiWorker(): Worker {
  return new Worker(getWorkerUrl(), { type: "module" });
}
