/// <reference types="jest" />
/// <reference types="node" />
import { Worker } from "worker_threads";
import path from "path";

const workerScriptPath = path.resolve(process.cwd(), "test-worker-bootstrap.mjs");
const worker = new Worker(workerScriptPath);

const send = (data: unknown): Promise<unknown> =>
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

const sendNoResponse = (data: unknown): Promise<void> => {
  worker.postMessage({ dataRequest: data });
  return new Promise((r) => setTimeout(r, 50));
};

const sendStream = (
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
        collected.push({ stream: m.stream, data: m.data, meta: m.meta, error: m.error });
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

afterAll(async () => {
  await worker.terminate();
});

describe("api.worker", () => {
  describe("validation", () => {
    it("responds with error when type is missing", async () => {
      const msg = (await send({ cacheName: "x", hookId: "h1" })) as {
        cacheName: string;
        data: null;
        error: { message: string };
        hookId: string;
      };
      expect(msg).toMatchObject({
        cacheName: "x",
        data: null,
        error: { message: "Invalid request: type is required" },
        hookId: "h1",
      });
    });

    it("responds with error when type is empty string", async () => {
      const msg = (await send({ type: "", cacheName: "x" })) as {
        cacheName: string;
        data: null;
        error: { message: string };
      };
      expect(msg).toMatchObject({
        cacheName: "x",
        data: null,
        error: { message: "Invalid request: type is required" },
      });
    });

    it("responds with error when cacheName is missing for get", async () => {
      const msg = (await send({ type: "get", hookId: "h1" })) as {
        cacheName: string;
        data: null;
        error: { message: string };
        hookId: string;
      };
      expect(msg).toMatchObject({
        cacheName: "",
        data: null,
        error: { message: "Invalid request: cacheName is required" },
        hookId: "h1",
      });
    });

    it("responds with error when cacheName is empty string for get", async () => {
      const msg = (await send({ type: "get", cacheName: "   " })) as {
        cacheName: string;
        data: null;
        error: { message: string };
      };
      expect(msg).toMatchObject({
        cacheName: "   ",
        data: null,
        error: { message: "Invalid request: cacheName is required" },
      });
    });

    it("responds with error when payload is missing for set without request", async () => {
      const msg = (await send({ type: "set", cacheName: "valid-key", hookId: "h1" })) as {
        cacheName: string;
        data: null;
        error: { message: string };
      };
      expect(msg).toMatchObject({
        cacheName: "valid-key",
        data: null,
        error: { message: "Invalid request: payload is required for set" },
      });
    });

    it("responds with error when payload is null for non-GET API request", async () => {
      const msg = (await send({
        type: "set",
        cacheName: "valid-key",
        request: { url: "https://example.com", method: "POST" },
        hookId: "h1",
      })) as { cacheName: string; data: null; error: { message: string } };
      expect(msg).toMatchObject({
        cacheName: "valid-key",
        data: null,
        error: { message: "Invalid request: payload is required for non-GET API request" },
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
      const msg = (await send({ type: "get", cacheName: "nonexistent-key", hookId: "h1" })) as {
        cacheName: string;
        data: null;
        error: { message: string };
        hookId: string;
      };
      expect(msg).toMatchObject({
        cacheName: "nonexistent-key",
        data: null,
        error: { message: "Cache miss" },
        hookId: "h1",
      });
    });

    it("responds with cached data when key exists", async () => {
      const cacheName = "get-hit-" + Math.random();
      await sendNoResponse({ type: "set", cacheName, payload: { value: 42 }, hookId: "h1" });
      const msg = (await send({ type: "get", cacheName, hookId: "h2" })) as {
        cacheName: string;
        data: { value: number };
        error: { message: string };
        hookId: string;
      };
      expect(msg).toMatchObject({ cacheName, data: { value: 42 }, error: { message: "" }, hookId: "h2" });
    });

    it("normalizes cacheName to lowercase for get", async () => {
      const cacheName = "GetCase-" + Math.random();
      await sendNoResponse({ type: "set", cacheName: cacheName.toUpperCase(), payload: { x: 1 } });
      const msg = (await send({ type: "get", cacheName: cacheName.toLowerCase() })) as {
        cacheName: string;
        data: { x: number };
        error: { message: string };
      };
      expect(msg).toMatchObject({ cacheName: cacheName.toLowerCase(), data: { x: 1 }, error: { message: "" } });
    });
  });

  describe("set (cache only)", () => {
    it("stores payload when no request; get returns stored data", async () => {
      const cacheName = "set-cache-" + Math.random();
      await sendNoResponse({ type: "set", cacheName, payload: { a: 1, b: 2 }, hookId: "h1" });
      const msg = (await send({ type: "get", cacheName })) as {
        cacheName: string;
        data: { a: number; b: number };
        error: { message: string };
      };
      expect(msg).toMatchObject({ cacheName, data: { a: 1, b: 2 }, error: { message: "" } });
    });
  });

  describe("delete", () => {
    it("removes key and responds with deleted: true", async () => {
      const cacheName = "delete-key-" + Math.random();
      await sendNoResponse({ type: "set", cacheName, payload: { keep: true } });
      const delMsg = (await send({ type: "delete", cacheName, hookId: "h1" })) as {
        cacheName: string;
        data: { deleted: boolean };
        error: { message: string };
        hookId: string;
      };
      expect(delMsg).toMatchObject({ cacheName, data: { deleted: true }, error: { message: "" }, hookId: "h1" });
      const getMsg = (await send({ type: "get", cacheName })) as {
        cacheName: string;
        data: null;
        error: { message: string };
      };
      expect(getMsg).toMatchObject({
        cacheName,
        data: null,
        error: { message: "Cache miss" },
      });
    });
  });

  describe("onmessage", () => {
    it("ignores message without dataRequest and worker still works", async () => {
      worker.postMessage({});
      await new Promise((r) => setTimeout(r, 50));
      const msg = (await send({ type: "get", cacheName: "after-empty-msg", hookId: "h1" })) as {
        cacheName: string;
        data: null;
        error: { message: string };
      };
      expect(msg).toMatchObject({
        cacheName: "after-empty-msg",
        data: null,
        error: { message: "Cache miss" },
      });
    });
  });

  describe("set with request (HTTP)", () => {
    it("GET request returns data and httpStatus", async () => {
      const cacheName = "http-get-" + Math.random();
      const msg = (await send({
        type: "set",
        cacheName,
        request: { url: "https://httpbin.org/get", method: "GET" },
        hookId: "h1",
      })) as {
        cacheName: string;
        hookId?: string;
        httpStatus?: number;
        data?: { url?: string };
        error: { message: string };
      };
      expect(msg).toMatchObject({ cacheName, hookId: "h1", error: { message: "" } });
      expect(msg.httpStatus).toBe(200);
      expect(msg.data).toBeDefined();
      expect(msg.data?.url).toBe("https://httpbin.org/get");
    });

    it("GET with responseType stream sends start, chunk(s), end", async () => {
      const cacheName = "http-stream-" + Math.random();
      const messages = await sendStream({
        type: "set",
        cacheName,
        request: {
          url: "https://httpbin.org/stream-bytes/128",
          method: "GET",
          responseType: "stream",
        },
        hookId: "h1",
      });
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].stream).toBe("start");
      expect(messages[0].meta).toBeDefined();
      expect(messages[messages.length - 1].stream).toBe("end");
      expect(messages[messages.length - 1].error?.message ?? "").toBe("");
      const chunks = messages.filter((m) => m.stream === "chunk");
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("streams audio URL in chunks (start, chunk(s), end)", async () => {
      const cacheName = "stream-audio-" + Math.random();
      const messages = await sendStream(
        {
          type: "set",
          cacheName,
          request: {
            url: "http://stream.smoothjazz.com:80/stream",
            method: "GET",
            responseType: "stream",
          },
          hookId: "h1",
        },
        20000,
      );
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[messages.length - 1].stream).toBe("end");
      if (messages.length >= 2) {
        expect(messages[0].stream).toBe("start");
        const chunks = messages.filter((m) => m.stream === "chunk");
        expect(chunks.length).toBeGreaterThanOrEqual(1);
      }
    }, 25000);

    it("streams video playlist URL in chunks (start, chunk(s), end)", async () => {
      const cacheName = "stream-video-" + Math.random();
      const messages = await sendStream(
        {
          type: "set",
          cacheName,
          request: {
            url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
            method: "GET",
            responseType: "stream",
          },
          hookId: "h1",
        },
        15000,
      );
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[messages.length - 1].stream).toBe("end");
      if (messages.length >= 2) {
        expect(messages[0].stream).toBe("start");
        const chunks = messages.filter((m) => m.stream === "chunk");
        expect(chunks.length).toBeGreaterThanOrEqual(1);
      }
    }, 20000);
  });
});
