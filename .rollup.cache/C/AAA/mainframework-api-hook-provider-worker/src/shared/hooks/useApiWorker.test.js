/// <reference types="jest" />
import { act, renderHook, waitFor } from "@testing-library/react";
import { useApiWorker } from "./useApiWorker";
// Same base URLs as api.worker.test.ts
const EXAMPLE_API = "https://example.com/api";
const RESTFUL_BASE = "https://api.restful-api.dev";
const HTTPBIN_BASE = "https://httpbin.org";
function getWorkerMock() {
  return globalThis.__WORKER_MOCK__;
}
/** Get the last dataRequest sent to the worker and optionally the hookId. */
function getLastDataRequest() {
  const mock = getWorkerMock();
  const calls = mock.getPostMessageCalls();
  expect(calls.length).toBeGreaterThan(0);
  const last = calls[calls.length - 1]?.[0];
  expect(last).toHaveProperty("dataRequest");
  return last;
}
/** Simulate worker success response and wait for hook to update. */
function simulateWorkerSuccess(cacheName, data, hookId, meta) {
  const mock = getWorkerMock();
  act(() => {
    mock.dispatchMessage({ cacheName, data, hookId, meta: meta ?? null });
  });
}
beforeEach(() => {
  getWorkerMock().clearPostMessage();
});
describe("useApiWorker", () => {
  describe("request config (same URLs as api.worker.test.ts)", () => {
    it("sends GET request to https://example.com/api when runMode is auto", () => {
      const cacheName = "useApiWorker-get-example-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: EXAMPLE_API, method: "GET" },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.type).toBe("set");
      expect(dataRequest.cacheName).toBe(cacheName);
      expect(dataRequest.request).toEqual({ url: EXAMPLE_API, method: "GET" });
      expect(result.current.loading).toBe(true);
      expect(typeof result.current.refetch).toBe("function");
      expect(typeof result.current.deleteCache).toBe("function");
    });
    it("sends POST request to https://example.com/api with payload", () => {
      const cacheName = "useApiWorker-post-example-" + Date.now();
      const payload = { name: "test" };
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: EXAMPLE_API, method: "POST" },
          data: payload,
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.type).toBe("set");
      expect(dataRequest.request).toEqual({ url: EXAMPLE_API, method: "POST" });
      expect(dataRequest.payload).toEqual(payload);
    });
    it("sends GET to https://api.restful-api.dev/objects (list)", () => {
      const cacheName = "useApiWorker-restful-list-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${RESTFUL_BASE}/objects`,
            method: "GET",
            headers: { "Content-Type": "application/json" },
          },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.request?.url).toBe(`${RESTFUL_BASE}/objects`);
      expect(dataRequest.request?.method).toBe("GET");
    });
    it("sends GET to https://api.restful-api.dev/objects/1 (single object)", () => {
      const cacheName = "useApiWorker-restful-one-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${RESTFUL_BASE}/objects/1`,
            method: "GET",
            headers: { "Content-Type": "application/json" },
          },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.request?.url).toBe(`${RESTFUL_BASE}/objects/1`);
    });
    it("sends POST to https://api.restful-api.dev/objects with payload", () => {
      const cacheName = "useApiWorker-restful-post-" + Date.now();
      const payload = {
        name: "Worker test object",
        data: { source: "useApiWorker.test", env: "jest" },
      };
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${RESTFUL_BASE}/objects`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          data: payload,
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.request?.url).toBe(`${RESTFUL_BASE}/objects`);
      expect(dataRequest.request?.method).toBe("POST");
      expect(dataRequest.payload).toEqual(payload);
    });
    it("sends PATCH to https://api.restful-api.dev/objects/6", () => {
      const cacheName = "useApiWorker-restful-patch-" + Date.now();
      const payload = { data: { price: 99, note: "updated by hook test" } };
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${RESTFUL_BASE}/objects/6`,
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
          },
          data: payload,
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.request?.url).toBe(`${RESTFUL_BASE}/objects/6`);
      expect(dataRequest.request?.method).toBe("PATCH");
      expect(dataRequest.payload).toEqual(payload);
    });
    it("sends GET to https://httpbin.org/stream/5", () => {
      const cacheName = "useApiWorker-httpbin-stream-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${HTTPBIN_BASE}/stream/5`,
            method: "GET",
            headers: { Accept: "application/json" },
          },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.request?.url).toBe(`${HTTPBIN_BASE}/stream/5`);
    });
    it("sends GET to https://httpbin.org/bytes/128 with responseType binary", () => {
      const cacheName = "useApiWorker-httpbin-bytes-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${HTTPBIN_BASE}/bytes/128`,
            method: "GET",
            responseType: "binary",
          },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.request?.url).toBe(`${HTTPBIN_BASE}/bytes/128`);
      expect(dataRequest.request?.responseType).toBe("binary");
    });
    it("sends GET to https://httpbin.org/drip (drip endpoint)", () => {
      const cacheName = "useApiWorker-httpbin-drip-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${HTTPBIN_BASE}/drip?numbytes=200&duration=1`,
            method: "GET",
            responseType: "binary",
          },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.request?.url).toContain(`${HTTPBIN_BASE}/drip`);
    });
  });
  describe("runMode and enabled", () => {
    it("does not send request when enabled is false", () => {
      const cacheName = "useApiWorker-disabled-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: EXAMPLE_API, method: "GET" },
          runMode: "auto",
          enabled: false,
        }),
      );
      expect(getWorkerMock().getPostMessageCalls().length).toBe(0);
    });
    it("sends request once when runMode is once; refetch does not send again (once = single auto-run)", async () => {
      const cacheName = "useApiWorker-once-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: EXAMPLE_API, method: "GET" },
          runMode: "once",
        }),
      );
      expect(getWorkerMock().getPostMessageCalls().length).toBe(1);
      const { dataRequest } = getLastDataRequest();
      simulateWorkerSuccess(cacheName, { first: true }, dataRequest.hookId);
      await waitFor(() => {
        expect(result.current.data).toEqual({ first: true });
      });
      act(() => {
        result.current.refetch();
      });
      // With runMode "once", refetch returns early and does not postMessage again
      expect(getWorkerMock().getPostMessageCalls().length).toBe(1);
    });
    it("manual runMode does not auto-send; refetch sends request", () => {
      const cacheName = "useApiWorker-manual-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: EXAMPLE_API, method: "GET" },
          runMode: "manual",
        }),
      );
      expect(getWorkerMock().getPostMessageCalls().length).toBe(0);
      expect(result.current.loading).toBe(false);
      act(() => {
        result.current.refetch();
      });
      expect(getWorkerMock().getPostMessageCalls().length).toBe(1);
      const { dataRequest } = getLastDataRequest();
      simulateWorkerSuccess(cacheName, { manual: true }, dataRequest.hookId);
      expect(result.current.data).toEqual({ manual: true });
    });
  });
  describe("worker error handling", () => {
    it("sends request so worker can respond with error payload", () => {
      const cacheName = "useApiWorker-error-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: EXAMPLE_API, method: "GET" },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.type).toBe("set");
      expect(dataRequest.cacheName).toBe(cacheName);
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();
    });
    it("sends get dataRequest when no request config so worker can respond with CACHE_MISS", () => {
      const cacheName = "useApiWorker-cache-miss-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.type).toBe("get");
      expect(dataRequest.cacheName).toBe(cacheName);
    });
  });
  describe("deleteCache", () => {
    it("sends delete dataRequest to worker", () => {
      const cacheName = "useApiWorker-delete-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: EXAMPLE_API, method: "GET" },
          runMode: "manual",
        }),
      );
      act(() => {
        result.current.deleteCache();
      });
      const calls = getWorkerMock().getPostMessageCalls();
      expect(calls.length).toBe(1);
      const sent = (calls[0]?.[0]).dataRequest;
      expect(sent.type).toBe("delete");
      expect(sent.cacheName).toBe(cacheName);
    });
  });
  describe("get-only (no request config)", () => {
    it("sends get dataRequest when cacheName only and runMode auto", () => {
      const cacheName = "useApiWorker-get-only-" + Date.now();
      renderHook(() =>
        useApiWorker({
          cacheName,
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      expect(dataRequest.type).toBe("get");
      expect(dataRequest.cacheName).toBe(cacheName);
    });
  });
  describe("meta (binary response)", () => {
    it("passes through meta from worker response", () => {
      const cacheName = "useApiWorker-meta-" + Date.now();
      const meta = { contentType: "application/octet-stream", contentDisposition: null };
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: `${HTTPBIN_BASE}/bytes/128`,
            method: "GET",
            responseType: "binary",
          },
          runMode: "auto",
        }),
      );
      const { dataRequest } = getLastDataRequest();
      const buffer = new ArrayBuffer(128);
      simulateWorkerSuccess(cacheName, buffer, dataRequest.hookId, meta);
      expect(result.current.meta).toEqual(meta);
      expect(result.current.data).toBe(buffer);
    });
  });
});
//# sourceMappingURL=useApiWorker.test.js.map
