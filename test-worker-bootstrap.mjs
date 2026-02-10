import { parentPort } from "worker_threads";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
let onmessageHandler = null;

globalThis.postMessage = (msg, transfer) => {
  parentPort.postMessage({ msg, transfer });
};
Object.defineProperty(globalThis, "onmessage", {
  get: () => onmessageHandler,
  set: (fn) => {
    onmessageHandler = fn;
  },
  configurable: true,
});
globalThis.self = globalThis;

parentPort.on("message", (data) => {
  if (onmessageHandler) onmessageHandler({ data });
});

const workerPath = path.join(__dirname, "dist", "api.worker.js");
await import(pathToFileURL(workerPath).href);
