/// <reference types="jest" />
import { act, renderHook, waitFor } from "@testing-library/react";
import { useApiWorker } from "./useApiWorker";

const HTTPBIN_GET = "https://httpbin.org/get";
const WAIT_MS = 15000;

jest.setTimeout(25000);

afterAll(async () => {
  const term = Reflect.get(globalThis, "__WORKER_TERMINATE__");
  if (typeof term === "function") await term();
});

describe("useApiWorker", () => {
  describe("API shape", () => {
    it("returns data, meta, loading, error, refetch, deleteCache", () => {
      const cacheName = "useApiWorker-shape-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: HTTPBIN_GET, method: "GET" },
          runMode: "manual",
        }),
      );

      expect(result.current).toHaveProperty("data");
      expect(result.current).toHaveProperty("meta");
      expect(result.current).toHaveProperty("loading");
      expect(result.current).toHaveProperty("error");
      expect(typeof result.current.refetch).toBe("function");
      expect(typeof result.current.deleteCache).toBe("function");
    });
  });

  describe("runMode auto", () => {
    it("with request sends on mount: loading true, refetch and deleteCache are functions", () => {
      const cacheName = "useApiWorker-auto-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: HTTPBIN_GET, method: "GET" },
          runMode: "auto",
        }),
      );

      expect(result.current.loading).toBe(true);
      expect(typeof result.current.refetch).toBe("function");
      expect(typeof result.current.deleteCache).toBe("function");
    });
  });

  describe("runMode once", () => {
    it("resolves once; refetch does not send again", async () => {
      const cacheName = "useApiWorker-once-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: HTTPBIN_GET, method: "GET" },
          runMode: "once",
        }),
      );

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: WAIT_MS },
      );
      const firstData = result.current.data;

      act(() => {
        result.current.refetch();
      });

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: WAIT_MS },
      );
      expect(result.current.data).toBe(firstData);
    });
  });

  describe("runMode manual", () => {
    it("does not auto-send; refetch sends and returns data", async () => {
      const cacheName = "useApiWorker-manual-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: HTTPBIN_GET, method: "GET" },
          runMode: "manual",
        }),
      );

      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBeNull();

      act(() => {
        result.current.refetch();
      });

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
          expect(result.current.data).toBeDefined();
        },
        { timeout: WAIT_MS },
      );
      expect((result.current.data as { url?: string })?.url).toBe(HTTPBIN_GET);
    });
  });

  describe("enabled false", () => {
    it("does not request; loading stays false and data null", async () => {
      const cacheName = "useApiWorker-disabled-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: HTTPBIN_GET, method: "GET" },
          runMode: "auto",
          enabled: false,
        }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.data).toBeNull();
    });
  });

  describe("get-only (no request config)", () => {
    it("refetch sends get; worker returns CACHE_MISS and hook exposes error", async () => {
      const cacheName = "useApiWorker-get-only-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          runMode: "manual",
        }),
      );

      expect(result.current.loading).toBe(false);
      act(() => {
        result.current.refetch();
      });
      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: WAIT_MS },
      );
      expect(result.current.error).not.toBeNull();
      expect(result.current.error).toBe("Cache miss");
    });
  });

  describe("deleteCache", () => {
    it("clears cache; refetch after delete still works", async () => {
      const cacheName = "useApiWorker-delete-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: { url: HTTPBIN_GET, method: "GET" },
          runMode: "manual",
        }),
      );

      act(() => {
        result.current.refetch();
      });
      await waitFor(
        () => {
          expect(result.current.data).toBeDefined();
        },
        { timeout: WAIT_MS },
      );

      act(() => {
        result.current.deleteCache();
      });

      act(() => {
        result.current.refetch();
      });
      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: WAIT_MS },
      );
      expect(result.current.data).toBeDefined();
    });
  });

  describe("binary response", () => {
    it("returns data and meta from worker", async () => {
      const cacheName = "useApiWorker-binary-" + Date.now();
      const { result } = renderHook(() =>
        useApiWorker({
          cacheName,
          request: {
            url: "https://httpbin.org/bytes/128",
            method: "GET",
            responseType: "binary",
          },
          runMode: "manual",
        }),
      );

      act(() => {
        result.current.refetch();
      });
      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: WAIT_MS },
      );
      expect(result.current.data).toBeDefined();
      expect(Object.prototype.toString.call(result.current.data)).toBe("[object ArrayBuffer]");
      expect(result.current.meta).toBeDefined();
    });
  });
});
