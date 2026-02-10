/// <reference types="jest" />
import { Worker } from "worker_threads";
import path from "path";
const bootstrapPath = path.resolve(process.cwd(), "test-worker-bootstrap.mjs");
let worker;
function send(data) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => {
      worker.off("message", handler);
      if (payload.error) reject(new Error(payload.error));
      else resolve(payload.msg);
    };
    worker.on("message", handler);
    worker.postMessage({ dataRequest: data });
    setTimeout(() => {
      worker.off("message", handler);
      reject(new Error("Timeout"));
    }, 3000);
  });
}
function sendNoResponse(data) {
  worker.postMessage({ dataRequest: data });
  return new Promise((r) => setTimeout(r, 10));
}
beforeAll(() => {
  worker = new Worker(bootstrapPath);
});
afterAll(() => {
  void worker.terminate();
});
describe("api.worker", () => {
  describe("validation", () => {
    it("responds with error when type is missing", async () => {
      const msg = await send({ cacheName: "x", hookId: "h1" });
      expect(msg).toMatchObject({
        cacheName: "error",
        data: { kind: "validation", message: "Invalid request: type is required", code: "INVALID_REQUEST" },
        hookId: "h1",
      });
    });
    it("responds with error when type is empty string", async () => {
      const msg = await send({ type: "", cacheName: "x" });
      expect(msg).toMatchObject({
        cacheName: "error",
        data: { kind: "validation", code: "INVALID_REQUEST" },
      });
    });
    it("responds with error when cacheName is missing for get", async () => {
      const msg = await send({ type: "get", hookId: "h1" });
      expect(msg).toMatchObject({
        cacheName: "error",
        data: { kind: "validation", message: "Invalid request: cacheName is required", code: "INVALID_REQUEST" },
      });
    });
    it("responds with error when cacheName is empty string for get", async () => {
      const msg = await send({ type: "get", cacheName: "   " });
      expect(msg).toMatchObject({
        cacheName: "error",
        data: { kind: "validation", code: "INVALID_REQUEST" },
      });
    });
    it("responds with error when payload is missing for set without request", async () => {
      const msg = await send({ type: "set", cacheName: "valid-key", hookId: "h1" });
      expect(msg).toMatchObject({
        cacheName: "error",
        data: { kind: "validation", message: "Invalid request: payload is required for set", code: "INVALID_REQUEST" },
      });
    });
    it("responds with error when payload is null for non-GET API request", async () => {
      const msg = await send({
        type: "set",
        cacheName: "valid-key",
        request: { url: "https://example.com", method: "POST" },
        hookId: "h1",
      });
      expect(msg).toMatchObject({
        cacheName: "error",
        data: {
          kind: "validation",
          message: "Invalid request: payload is required for non-GET API request",
          code: "INVALID_REQUEST",
        },
      });
    });
  });
  describe("cancel", () => {
    it("handles cancel without throwing", async () => {
      await sendNoResponse({ type: "cancel" });
    });
    it("handles cancel with requestId", async () => {
      await sendNoResponse({ type: "cancel", requestId: "req-1" });
    });
  });
  describe("get", () => {
    it("responds with CACHE_MISS when key is not in cache", async () => {
      const msg = await send({ type: "get", cacheName: "nonexistent-key-1", hookId: "h1" });
      expect(msg).toMatchObject({
        cacheName: "nonexistent-key-1",
        data: { kind: "validation", message: "Cache miss", code: "CACHE_MISS" },
        hookId: "h1",
      });
    });
    it("responds with cached data when key exists", async () => {
      const cacheName = "get-hit-key-" + Math.random();
      await sendNoResponse({ type: "set", cacheName, payload: { value: 42 }, hookId: "h1" });
      const msg = await send({ type: "get", cacheName, hookId: "h2" });
      expect(msg).toMatchObject({ cacheName, data: { value: 42 }, hookId: "h2" });
    });
    it("normalizes cacheName to lowercase for get", async () => {
      const cacheName = "GetCaseKey-" + Math.random();
      await sendNoResponse({ type: "set", cacheName: cacheName.toUpperCase(), payload: { x: 1 } });
      const msg = await send({ type: "get", cacheName: cacheName.toLowerCase() });
      expect(msg).toMatchObject({ cacheName: cacheName.toLowerCase(), data: { x: 1 } });
    });
  });
  describe("set (cache only)", () => {
    it("stores payload when no request; get returns stored data", async () => {
      const cacheName = "set-cache-only-" + Math.random();
      await sendNoResponse({ type: "set", cacheName, payload: { a: 1, b: 2 }, hookId: "h1" });
      const msg = await send({ type: "get", cacheName });
      expect(msg).toMatchObject({ cacheName, data: { a: 1, b: 2 } });
    });
  });
  describe("delete", () => {
    it("removes key and responds with deleted: true", async () => {
      const cacheName = "delete-key-" + Math.random();
      await sendNoResponse({ type: "set", cacheName, payload: { keep: true } });
      const delMsg = await send({ type: "delete", cacheName, hookId: "h1" });
      expect(delMsg).toMatchObject({ cacheName, data: { deleted: true }, hookId: "h1" });
      const getMsg = await send({ type: "get", cacheName });
      expect(getMsg).toMatchObject({
        cacheName,
        data: { kind: "validation", message: "Cache miss", code: "CACHE_MISS" },
      });
    });
  });
});
//# sourceMappingURL=api.worker.test.js.map
