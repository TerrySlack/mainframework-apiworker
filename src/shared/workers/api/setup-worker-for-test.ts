/**
 * Setup for tests that exercise the worker directly.
 * Only worker-direct tests (e.g. api.worker.test.ts) should import this.
 */
/// <reference types="node" />
import { Worker } from "worker_threads";
import path from "path";

const workerScriptPath = path.resolve(process.cwd(), "test-worker-bootstrap.mjs");
export const worker = new Worker(workerScriptPath);

export const send = (data: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const handler = (payload: { msg?: unknown; error?: string }) => {
      worker.off("message", handler);
      if (payload.error) reject(new Error(payload.error));
      else resolve(payload.msg);
    };
    worker.on("message", handler);
    worker.postMessage({ dataRequest: data });
    setTimeout(() => {
      worker.off("message", handler);
      reject(new Error("Timeout"));
    }, 5000);
  });

export const sendNoResponse = (data: unknown): Promise<void> => {
  worker.postMessage({ dataRequest: data });
  return new Promise((r) => setTimeout(r, 50));
};

export const sendStream = (
  data: unknown,
  timeoutMs = 10000,
): Promise<{ stream: string; data?: ArrayBuffer; meta?: unknown; error?: { message: string } }[]> =>
  new Promise((resolve, reject) => {
    const collected: { stream: string; data?: ArrayBuffer; meta?: unknown; error?: { message: string } }[] = [];
    const handler = (payload: {
      msg?: { stream?: string; data?: ArrayBuffer; meta?: unknown; error?: { message: string } };
      error?: string;
    }) => {
      if (payload.error) {
        worker.off("message", handler);
        reject(new Error(payload.error));
        return;
      }
      const m = payload.msg;
      if (m && "stream" in m && m.stream) {
        const item: { stream: string; data?: ArrayBuffer; meta?: unknown; error?: { message: string } } = {
          stream: m.stream,
        };
        if (m.data !== undefined) item.data = m.data;
        if (m.meta !== undefined) item.meta = m.meta;
        if (m.error !== undefined) item.error = m.error;
        collected.push(item);
        if (m.stream === "end") {
          worker.off("message", handler);
          resolve(collected);
        }
      }
    };
    worker.on("message", handler);
    worker.postMessage({ dataRequest: data });
    setTimeout(() => {
      worker.off("message", handler);
      reject(new Error("Stream timeout"));
    }, timeoutMs);
  });
