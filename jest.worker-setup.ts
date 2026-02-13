/**
 * Provides the real api.worker to the hook via global Worker.
 * Uses worker_threads + test-worker-bootstrap so the hook talks to the actual worker.
 * pretest runs yarn build, so dist/api.worker.js always exists.
 */

/// <reference types="node" />
import { act } from "@testing-library/react";
import { Worker as NodeWorker } from "worker_threads";
import path from "path";

const bootstrapPath = path.resolve(process.cwd(), "test-worker-bootstrap.mjs");
const nodeWorker = new NodeWorker(bootstrapPath);

let onmessageHandler: ((e: MessageEvent) => void) | null = null;

const realWorkerAdapter = {
  postMessage(msg: unknown) {
    nodeWorker.postMessage(msg);
  },
  get onmessage() {
    return onmessageHandler;
  },
  set onmessage(fn: ((e: MessageEvent) => void) | null) {
    onmessageHandler = fn;
  },
  terminate: () => {
    void nodeWorker.terminate();
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

nodeWorker.on("message", (payload: { msg?: unknown; error?: string }) => {
  if (!onmessageHandler) return;
  const event = payload.error
    ? ({ data: { cacheName: "error", data: null, error: { message: payload.error } } } as MessageEvent)
    : ({ data: payload.msg } as MessageEvent);
  act(() => {
    onmessageHandler!(event);
  });
});

function RealWorkerConstructor() {
  return realWorkerAdapter;
}

const RealWorker = RealWorkerConstructor as unknown as typeof Worker;
const g =
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof global !== "undefined"
      ? global
      : typeof window !== "undefined"
        ? window
        : {};
(g as { Worker?: typeof Worker }).Worker = RealWorker;
if (typeof global !== "undefined") (global as { Worker?: typeof Worker }).Worker = RealWorker;
if (typeof window !== "undefined") (window as { Worker?: typeof Worker }).Worker = RealWorker;
(g as { __FETCH_IS_STUB__?: boolean }).__FETCH_IS_STUB__ = false;
(g as { __WORKER_TERMINATE__?: () => Promise<void> }).__WORKER_TERMINATE__ = async () => {
  await nodeWorker.terminate();
};
