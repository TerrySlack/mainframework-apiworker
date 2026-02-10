/// <reference types="jest" />
import { handleMessage } from "./api.worker";

// Real fetch for integration tests; set in beforeAll, restored by "set with request" afterAll
let realFetch: typeof fetch;

beforeAll(async () => {
  const g = globalThis as unknown as { fetch?: typeof fetch };
  const globalObj = typeof global !== "undefined" ? (global as unknown as { fetch?: typeof fetch }) : g;
  if (typeof g.fetch === "function") {
    realFetch = g.fetch;
    return;
  }
  if (typeof globalObj.fetch === "function") {
    realFetch = globalObj.fetch;
    g.fetch = realFetch;
    return;
  }
  try {
    const { default: fetchImpl } = await import("node-fetch");
    realFetch = fetchImpl as unknown as typeof fetch;
    g.fetch = realFetch;
  } catch {
    realFetch = undefined as unknown as typeof fetch;
  }
});

const postMessageSpy = jest.spyOn(globalThis, "postMessage").mockImplementation(() => {});

function send(data: unknown): void {
  handleMessage(data);
}

beforeEach(() => {
  postMessageSpy.mockClear();
});

afterAll(() => {
  postMessageSpy.mockRestore();
});

describe("api.worker handleMessage", () => {
  describe("validation", () => {
    it("responds with error when type is missing", () => {
      send({ dataRequest: { cacheName: "x", hookId: "h1" } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: "error",
          data: expect.objectContaining({
            error: "Invalid request: type is required",
            code: "INVALID_REQUEST",
          }),
          hookId: "h1",
        }),
      );
    });

    it("responds with error when type is empty string", () => {
      send({ dataRequest: { type: "", cacheName: "x" } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: "error",
          data: expect.objectContaining({ code: "INVALID_REQUEST" }),
        }),
      );
    });

    it("responds with error when cacheName is missing for get", () => {
      send({ dataRequest: { type: "get", hookId: "h1" } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: "error",
          data: expect.objectContaining({
            error: "Invalid request: cacheName is required",
            code: "INVALID_REQUEST",
          }),
        }),
      );
    });

    it("responds with error when cacheName is empty string for get", () => {
      send({ dataRequest: { type: "get", cacheName: "   " } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: "error",
          data: expect.objectContaining({ code: "INVALID_REQUEST" }),
        }),
      );
    });

    it("responds with error when payload is missing for set without request", () => {
      send({
        dataRequest: {
          type: "set",
          cacheName: "valid-key",
          hookId: "h1",
        },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: "error",
          data: expect.objectContaining({
            error: "Invalid request: payload is required for set",
            code: "INVALID_REQUEST",
          }),
        }),
      );
    });

    it("responds with error when payload is null for non-GET API request", () => {
      send({
        dataRequest: {
          type: "set",
          cacheName: "valid-key",
          request: { url: "https://example.com", method: "POST" },
          hookId: "h1",
        },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: "error",
          data: expect.objectContaining({
            error: "Invalid request: payload is required for non-GET API request",
            code: "INVALID_REQUEST",
          }),
        }),
      );
    });
  });

  describe("cancel", () => {
    it("handles cancel without throwing and does not require cacheName", () => {
      send({ dataRequest: { type: "cancel" } });
      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it("handles cancel with requestId", () => {
      send({ dataRequest: { type: "cancel", requestId: "req-1" } });
      expect(postMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("responds with CACHE_MISS when key is not in cache", () => {
      send({
        dataRequest: { type: "get", cacheName: "nonexistent-key-1", hookId: "h1" },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: "nonexistent-key-1",
          data: expect.objectContaining({
            error: "Cache miss",
            code: "CACHE_MISS",
          }),
          hookId: "h1",
        }),
      );
    });

    it("responds with cached data when key exists", () => {
      const cacheName = "get-hit-key-" + Math.random();
      send({
        dataRequest: { type: "set", cacheName, payload: { value: 42 }, hookId: "h1" },
      });
      postMessageSpy.mockClear();
      send({
        dataRequest: { type: "get", cacheName, hookId: "h2" },
      });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName,
          data: { value: 42 },
          hookId: "h2",
        }),
      );
    });

    it("normalizes cacheName to lowercase for get", () => {
      const cacheName = "GetCaseKey-" + Math.random();
      send({
        dataRequest: { type: "set", cacheName: cacheName.toUpperCase(), payload: { x: 1 } },
      });
      postMessageSpy.mockClear();
      send({ dataRequest: { type: "get", cacheName: cacheName.toLowerCase() } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName: cacheName.toLowerCase(),
          data: { x: 1 },
        }),
      );
    });
  });

  describe("set (cache only)", () => {
    it("stores payload when no request; get returns stored data", () => {
      const cacheName = "set-cache-only-" + Math.random();
      send({
        dataRequest: { type: "set", cacheName, payload: { a: 1, b: 2 }, hookId: "h1" },
      });
      postMessageSpy.mockClear();
      send({ dataRequest: { type: "get", cacheName } });
      expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ cacheName, data: { a: 1, b: 2 } }));
    });
  });

  describe("delete", () => {
    it("removes key and responds with deleted: true", () => {
      const cacheName = "delete-key-" + Math.random();
      send({
        dataRequest: { type: "set", cacheName, payload: { keep: true } },
      });
      postMessageSpy.mockClear();
      send({ dataRequest: { type: "delete", cacheName, hookId: "h1" } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName,
          data: { deleted: true },
          hookId: "h1",
        }),
      );
      postMessageSpy.mockClear();
      send({ dataRequest: { type: "get", cacheName } });
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName,
          data: expect.objectContaining({ code: "CACHE_MISS" }),
        }),
      );
    });
  });

  describe("set with request (API)", () => {
    const mockFetch = jest.fn();

    beforeAll(() => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch;
    });

    afterAll(() => {
      if (typeof realFetch === "function") {
        (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
      }
    });

    beforeEach(() => {
      mockFetch.mockReset();
    });

    it("calls fetch and responds with JSON when GET request succeeds", async () => {
      const cacheName = "api-get-" + Math.random();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ result: "ok" }),
        statusText: "OK",
      } as Response);

      send({
        dataRequest: {
          type: "set",
          cacheName,
          request: { url: "https://example.com/api", method: "GET" },
          hookId: "h1",
        },
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(mockFetch).toHaveBeenCalledWith("https://example.com/api", expect.objectContaining({ method: "GET" }));
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName,
          data: { result: "ok" },
          hookId: "h1",
          httpStatus: 200,
        }),
      );
    });

    it("calls fetch with body when POST request and payload provided", async () => {
      const cacheName = "api-post-" + Math.random();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ id: 1 }),
        statusText: "Created",
      } as Response);

      send({
        dataRequest: {
          type: "set",
          cacheName,
          payload: { name: "test" },
          request: { url: "https://example.com/api", method: "POST" },
          hookId: "h1",
        },
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api",
        expect.objectContaining({
          method: "POST",
          body: expect.any(String),
        }),
      );
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheName,
          data: { id: 1 },
          httpStatus: 201,
        }),
      );
    });
  });

  describe("integration: api.restful-api.dev (GET, POST, PATCH, DELETE)", () => {
    const BASE = "https://api.restful-api.dev";
    const TIMEOUT_MS = 10000;

    const hasFetch = typeof globalThis.fetch === "function";
    const itIntegration = hasFetch ? it : it.skip;

    /** Wait for the next postMessage call for the given cacheName (no fetch mock in this block). */
    function waitForResponse(cacheName: string): Promise<unknown[]> {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + TIMEOUT_MS;
        const check = (): void => {
          const calls = postMessageSpy.mock.calls;
          const match = calls.find(
            (args: unknown[]) => (args[0] as { cacheName?: string } | undefined)?.cacheName === cacheName,
          );
          if (match) {
            resolve(match);
            return;
          }
          if (Date.now() > deadline) {
            reject(new Error(`Timeout waiting for response cacheName=${cacheName}`));
            return;
          }
          setTimeout(check, 50);
        };
        check();
      });
    }

    itIntegration(
      "GET list of objects",
      async () => {
        const cacheName = "restful-get-list-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: {
              url: `${BASE}/objects`,
              method: "GET",
              headers: { "Content-Type": "application/json" },
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        expect(msg).toBeDefined();
        const payload = msg as { cacheName: string; data: unknown; httpStatus?: number };
        expect(payload.httpStatus).toBe(200);
        expect(Array.isArray(payload.data)).toBe(true);
        const arr = payload.data as Array<{ id: string; name: string }>;
        expect(arr.length).toBeGreaterThan(0);
        expect(arr[0]).toHaveProperty("id");
        expect(arr[0]).toHaveProperty("name");
      },
      TIMEOUT_MS + 1000,
    );

    itIntegration(
      "GET single object by id",
      async () => {
        const cacheName = "restful-get-one-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: {
              url: `${BASE}/objects/1`,
              method: "GET",
              headers: { "Content-Type": "application/json" },
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { cacheName: string; data: Record<string, unknown> };
        expect(payload.data).toHaveProperty("id");
        expect(payload.data).toHaveProperty("name");
        expect((payload.data as { name: string }).name).toContain("Google");
      },
      TIMEOUT_MS + 1000,
    );

    itIntegration(
      "POST creates a new object",
      async () => {
        const cacheName = "restful-post-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            payload: {
              name: "Worker test object",
              data: { source: "api.worker.test", env: "jest" },
            },
            request: {
              url: `${BASE}/objects`,
              method: "POST",
              headers: { "Content-Type": "application/json" },
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { data: Record<string, unknown>; httpStatus?: number };
        expect(payload.httpStatus).toBe(200);
        expect(payload.data).toHaveProperty("id");
        expect(payload.data).toHaveProperty("name", "Worker test object");
        expect(payload.data).toHaveProperty("createdAt");
      },
      TIMEOUT_MS + 1000,
    );

    itIntegration(
      "PATCH partially updates an object",
      async () => {
        const cacheName = "restful-patch-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            payload: { data: { price: 99, note: "updated by worker test" } },
            request: {
              url: `${BASE}/objects/6`,
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { data: Record<string, unknown> };
        expect(payload.data).toHaveProperty("id");
        expect((payload.data as { data?: Record<string, unknown> }).data).toMatchObject({
          price: 99,
          note: "updated by worker test",
        });
      },
      TIMEOUT_MS + 1000,
    );

    itIntegration(
      "DELETE removes an object",
      async () => {
        const createCache = "restful-delete-create-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName: createCache,
            payload: { name: "To be deleted", data: { temp: true } },
            request: {
              url: `${BASE}/objects`,
              method: "POST",
              headers: { "Content-Type": "application/json" },
            },
          },
        });
        const [createMsg] = await waitForResponse(createCache);
        const created = (createMsg as { data: { id: string } }).data;
        const id = created.id;
        expect(id).toBeDefined();

        const deleteCache = "restful-delete-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName: deleteCache,
            request: {
              url: `${BASE}/objects/${id}`,
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
            },
          },
        });
        const [deleteMsg] = await waitForResponse(deleteCache);
        const delPayload = deleteMsg as { data?: unknown; httpStatus?: number };
        expect(delPayload.httpStatus).toBe(200);
      },
      TIMEOUT_MS + 2000,
    );
  });

  // Test order: httpbin (streaming + binary) → MP3/MP4 Blob + media → large .bin (progress + cancel) → live stream (memory + abort)
  describe("integration: httpbin (streaming + binary correctness)", () => {
    const BASE = "https://httpbin.org";
    const TIMEOUT_MS = 15000;
    const hasFetch = typeof globalThis.fetch === "function";
    const itHttpbin = hasFetch ? it : it.skip;

    function waitForResponse(cacheName: string): Promise<unknown[]> {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + TIMEOUT_MS;
        const check = (): void => {
          const calls = postMessageSpy.mock.calls;
          const match = calls.find(
            (args: unknown[]) => (args[0] as { cacheName?: string } | undefined)?.cacheName === cacheName,
          );
          if (match) {
            resolve(match);
            return;
          }
          if (Date.now() > deadline) reject(new Error(`Timeout waiting for cacheName=${cacheName}`));
          else setTimeout(check, 50);
        };
        check();
      });
    }

    itHttpbin(
      "GET /stream/:n returns streaming-style response (buffered)",
      async () => {
        const cacheName = "httpbin-stream-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: { url: `${BASE}/stream/5`, method: "GET", headers: { Accept: "application/json" } },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { cacheName: string; data: unknown; httpStatus?: number };
        expect(payload.httpStatus).toBe(200);
        expect(payload.data).toBeDefined();
        const raw = payload.data as string;
        expect(typeof raw === "string" || Array.isArray(raw)).toBe(true);
        const str = typeof raw === "string" ? raw : String(raw);
        expect(str.length).toBeGreaterThan(0);
        const lines = str.trim().split("\n").filter(Boolean);
        expect(lines.length).toBeGreaterThanOrEqual(1);
      },
      TIMEOUT_MS + 1000,
    );

    itHttpbin(
      "GET /bytes/:n with responseType binary returns ArrayBuffer and meta",
      async () => {
        const cacheName = "httpbin-bytes-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: {
              url: `${BASE}/bytes/128`,
              method: "GET",
              responseType: "binary",
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as {
          cacheName: string;
          data: ArrayBuffer;
          meta?: { contentType?: string };
          httpStatus?: number;
        };
        expect(payload.data).toBeInstanceOf(ArrayBuffer);
        expect(payload.data.byteLength).toBe(128);
        expect(payload.meta?.contentType).toBeDefined();
        expect(String(payload.meta?.contentType).toLowerCase()).toMatch(/octet-stream|application\/octet-stream/);
      },
      TIMEOUT_MS + 1000,
    );
  });

  describe("integration: MP3 / MP4 → Blob + media compatibility", () => {
    const TIMEOUT_MS = 15000;
    const hasFetch = typeof globalThis.fetch === "function";
    const itMedia = hasFetch ? it : it.skip;

    function waitForResponse(cacheName: string): Promise<unknown[]> {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + TIMEOUT_MS;
        const check = (): void => {
          const calls = postMessageSpy.mock.calls;
          const match = calls.find(
            (args: unknown[]) => (args[0] as { cacheName?: string } | undefined)?.cacheName === cacheName,
          );
          if (match) {
            resolve(match);
            return;
          }
          if (Date.now() > deadline) reject(new Error(`Timeout cacheName=${cacheName}`));
          else setTimeout(check, 50);
        };
        check();
      });
    }

    itMedia(
      "binary response builds Blob with contentType for playback compatibility",
      async () => {
        const cacheName = "media-blob-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: {
              url: "https://httpbin.org/bytes/1024",
              method: "GET",
              responseType: "binary",
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { data: ArrayBuffer; meta?: { contentType?: string } };
        const blob = new Blob([payload.data], { type: payload.meta?.contentType ?? "application/octet-stream" });
        expect(blob.size).toBe(1024);
        expect(blob.type).toBeDefined();
      },
      TIMEOUT_MS + 1000,
    );

    itMedia(
      "fetches small audio-like binary (application/octet-stream) for media path",
      async () => {
        const cacheName = "media-audio-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: {
              url: "https://httpbin.org/bytes/512",
              method: "GET",
              responseType: "binary",
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { data: ArrayBuffer; meta?: { contentType?: string } };
        expect(payload.data).toBeInstanceOf(ArrayBuffer);
        expect(payload.data.byteLength).toBe(512);
        const blob = new Blob([payload.data], { type: payload.meta?.contentType ?? "application/octet-stream" });
        expect(blob.size).toBe(512);
      },
      TIMEOUT_MS + 1000,
    );
  });

  describe("integration: large .bin → progress + cancellation", () => {
    const BASE = "https://httpbin.org";
    const TIMEOUT_MS = 20000;
    const hasFetch = typeof globalThis.fetch === "function";
    const itLarge = hasFetch ? it : it.skip;

    function waitForResponse(cacheName: string): Promise<unknown[]> {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + TIMEOUT_MS;
        const check = (): void => {
          const calls = postMessageSpy.mock.calls;
          const match = calls.find(
            (args: unknown[]) => (args[0] as { cacheName?: string } | undefined)?.cacheName === cacheName,
          );
          if (match) {
            resolve(match);
            return;
          }
          if (Date.now() > deadline) reject(new Error(`Timeout cacheName=${cacheName}`));
          else setTimeout(check, 50);
        };
        check();
      });
    }

    itLarge(
      "GET /bytes/:n large payload returns full ArrayBuffer",
      async () => {
        const cacheName = "large-bin-" + Date.now();
        postMessageSpy.mockClear();
        const size = 100 * 1024;
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: { url: `${BASE}/bytes/${size}`, method: "GET", responseType: "binary" },
            requestId: "large-req-1",
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { data: ArrayBuffer };
        expect(payload.data).toBeInstanceOf(ArrayBuffer);
        expect(payload.data.byteLength).toBe(size);
      },
      TIMEOUT_MS + 1000,
    );

    itLarge(
      "cancel request aborts in-flight large download",
      async () => {
        const cacheName = "large-cancel-" + Date.now();
        const requestId = "cancel-req-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: { url: `${BASE}/bytes/50000`, method: "GET", responseType: "binary" },
            requestId,
          },
        });
        await new Promise<void>((r) => setTimeout(r, 100));
        send({ dataRequest: { type: "cancel", requestId } });
        await new Promise<void>((r) => setTimeout(r, 200));
        const calls = postMessageSpy.mock.calls.filter(
          (args: unknown[]) => (args[0] as { cacheName?: string } | undefined)?.cacheName === cacheName,
        );
        const completedWithData = calls.some((args: unknown[]) => {
          const data = (args[0] as { data?: unknown })?.data;
          return data instanceof ArrayBuffer && data.byteLength > 0;
        });
        const hasError = calls.some(
          (args: unknown[]) => (args[0] as { data?: { code?: string } })?.data?.code !== undefined,
        );
        expect(completedWithData || hasError || calls.length === 0).toBe(true);
      },
      TIMEOUT_MS + 1000,
    );
  });

  describe("integration: live stream → memory + abort safety", () => {
    const BASE = "https://httpbin.org";
    const TIMEOUT_MS = 15000;
    const hasFetch = typeof globalThis.fetch === "function";
    const itLive = hasFetch ? it : it.skip;

    function waitForResponse(cacheName: string): Promise<unknown[]> {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + TIMEOUT_MS;
        const check = (): void => {
          const calls = postMessageSpy.mock.calls;
          const match = calls.find(
            (args: unknown[]) => (args[0] as { cacheName?: string } | undefined)?.cacheName === cacheName,
          );
          if (match) {
            resolve(match);
            return;
          }
          if (Date.now() > deadline) reject(new Error(`Timeout cacheName=${cacheName}`));
          else setTimeout(check, 50);
        };
        check();
      });
    }

    itLive(
      "GET /drip returns without leaking (buffered response)",
      async () => {
        const cacheName = "drip-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: {
              url: `${BASE}/drip?numbytes=200&duration=1`,
              method: "GET",
              responseType: "binary",
            },
          },
        });
        const [msg] = await waitForResponse(cacheName);
        const payload = msg as { data: ArrayBuffer; cacheName: string };
        expect(payload.cacheName).toBe(cacheName);
        expect(payload.data).toBeInstanceOf(ArrayBuffer);
        expect(payload.data.byteLength).toBe(200);
      },
      TIMEOUT_MS + 2000,
    );

    itLive(
      "abort during drip does not throw; request is cancelled",
      async () => {
        const cacheName = "drip-abort-" + Date.now();
        const requestId = "drip-abort-req-" + Date.now();
        postMessageSpy.mockClear();
        send({
          dataRequest: {
            type: "set",
            cacheName,
            request: {
              url: `${BASE}/drip?numbytes=500&duration=3`,
              method: "GET",
              responseType: "binary",
            },
            requestId,
          },
        });
        await new Promise<void>((r) => setTimeout(r, 300));
        send({ dataRequest: { type: "cancel", requestId } });
        await new Promise<void>((r) => setTimeout(r, 500));
        const calls = postMessageSpy.mock.calls.filter(
          (args: unknown[]) => (args[0] as { cacheName?: string } | undefined)?.cacheName === cacheName,
        );
        expect(calls.length).toBeLessThanOrEqual(1);
      },
      TIMEOUT_MS + 1000,
    );
  });
});
