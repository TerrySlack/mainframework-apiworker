/// <reference types="jest" />
import { act, renderHook, waitFor } from "@testing-library/react";
import { useApiWorker } from "./useApiWorker";

const STREAM_URL = "https://httpbin.org/stream-bytes/128";
const WAIT_MS = 15000;

jest.setTimeout(25000);

afterAll(async () => {
  const term = Reflect.get(globalThis, "__WORKER_TERMINATE__");
  if (typeof term === "function") await term();
});

describe("useApiWorker stream (hook only)", () => {
  it("exposes stream API shape: data, meta, loading, error, refetch, deleteCache, streamChunks", () => {
    const cacheName = "stream-shape-" + Date.now();
    const { result } = renderHook(() =>
      useApiWorker({
        cacheName,
        request: {
          url: STREAM_URL,
          method: "GET",
          responseType: "stream",
        },
        runMode: "manual",
      }),
    );

    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("meta");
    expect(result.current).toHaveProperty("loading");
    expect(result.current).toHaveProperty("error");
    expect(typeof result.current.refetch).toBe("function");
    expect(typeof result.current.deleteCache).toBe("function");
    expect(result.current).toHaveProperty("streamChunks");
    expect(result.current.streamChunks === undefined || Array.isArray(result.current.streamChunks)).toBe(true);
  });

  it("stream response: refetch returns Blob in data and streamChunks array when complete", async () => {
    const cacheName = "stream-integration-" + Date.now();
    const { result } = renderHook(() =>
      useApiWorker({
        cacheName,
        request: {
          url: STREAM_URL,
          method: "GET",
          responseType: "stream",
        },
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

    expect(Object.prototype.toString.call(result.current.data)).toBe("[object Blob]");
    expect(result.current.streamChunks).toBeDefined();
    expect(Array.isArray(result.current.streamChunks)).toBe(true);
  });
});
