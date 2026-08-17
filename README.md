# @mainframework/api-request-worker

**Requires Node.js 18+** (for global `fetch` when running in Node; browsers rely on their native fetch).

A framework-agnostic, Web Worker–backed data layer designed to keep your UI thread responsive and your application fast. This library moves all API requests and application state management into a dedicated singleton worker, handling caching, in-flight request deduplication, streaming and binary responses, while exposing data to your main thread on demand.

The library is **framework- and library-agnostic**: you use the worker via the standard `postMessage` API from vanilla JavaScript or from any framework (React, Angular, Vue, Preact, SolidJS, etc.). A **React hook (`useApiWorker`) is provided as a convenience** for React engineers; you may use it or implement your own integration against the worker protocol.

---

## Why Use This Library?

- **Non-blocking UI**: All network requests and state management happen off the main thread, keeping your UI buttery smooth
- **Built-in caching**: Automatic response caching with flexible cache key management
- **Request deduplication**: Multiple requests for the same resource are automatically collapsed into a single network call
- **Streaming support**: Handle large files and real-time streams with incremental chunk delivery
- **Binary file support**: First-class support for images, PDFs, and other binary content
- **Framework agnostic**: Works in vanilla JavaScript or with any framework
- **No framework lock-in**: Use the worker from any stack; the included React hook is optional
- **TypeScript ready**: Full type definitions included

---

## Response Types and Download Behavior

`responseType` controls in-flight deduplication and streaming behavior. For non-stream requests, **response parsing follows the server's `Content-Type` header**, not `responseType` — a GET without `responseType: "binary"` can still return an `ArrayBuffer` when the server sends a binary content type.

| `responseType`               | Effect                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| omitted / `"json"` (default) | In-flight dedupe enabled (keyed by `cacheName`). Full response buffered and sent in one `type: "result"` message.                          |
| `"binary"`                   | Skips in-flight dedupe (always fetches fresh). Response still parsed by `Content-Type`; binary bodies arrive as `ArrayBuffer` with `meta`. |
| `"stream"`                   | Enables incremental delivery (`start` → `chunk` → ... → `end`), Range-based retries, and hook `streamChunks`.                              |

- **`responseType: "stream"`**: The worker sends chunks as they arrive, enabling audio/video playback before the full file downloads. The React hook exposes the latest flushed batch in `streamChunks` (`ArrayBuffer[]`) and a final `Blob` in `data` when complete. Throttling (default: every 5 chunks, configurable via `streamChunkBatchSize`) minimizes re-renders. For vanilla JavaScript, handle `type: "stream"` messages manually.

Binary and stream responses are not stored in the worker cache; only json/text responses are cached.

---

## Installation

```bash
npm i @mainframework/api-request-worker
# or
pnpm add @mainframework/api-request-worker
```

If you use the optional React hook, a peer dependency `react >= 19` is required.

---

## Quickstart

### React

```ts
import { useApiWorker } from "@mainframework/api-request-worker/react";

export function Todos() {
  const { data, loading, error, refetch } = useApiWorker<{ id: string; title: string }[]>({
    cacheName: "todos",
    request: { url: "https://api.example.com/todos", method: "GET" },
    runMode: "auto",
  });

  if (loading) return null;
  if (error) return null;

  return (
    <div>
      <button onClick={refetch}>Refresh</button>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

### Vanilla JS/TS

```ts
import { createApiWorker } from "@mainframework/api-request-worker";

const worker = createApiWorker();
const cacheName = "todos";

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.cacheName !== cacheName) return;
  if (msg.error?.message) throw new Error(msg.error.message);
  console.log(msg.data);
};

worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName,
    request: { url: "https://api.example.com/todos", method: "GET" },
  },
});
```

### Public imports only

Use only these import paths. Do not import the worker script directly.

| Use case    | Import from                               | What you get                                                                                                                                                       |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vanilla** | `@mainframework/api-request-worker`       | `createApiWorker`, `RequestConfig`, `DataRequest`, `BinaryResponseMeta`, `WorkerMessagePayload`, `WorkerErrorCode`, `WorkerResponseType`, and other protocol types |
| **React**   | `@mainframework/api-request-worker/react` | `useApiWorker`, `RequestConfig`, `UseApiWorkerConfig`, `UseApiWorkerReturn`                                                                                        |

The worker is not a public entry. Obtain it only by calling `createApiWorker()` from the main package (or use the React hook, which uses `createApiWorker` internally).

---

## Bundler notes (Vite / Webpack / Next.js)

- **Vite**: Works out of the box. The worker is created via `new Worker(new URL(..., import.meta.url), { type: "module" })`.

- **Webpack**: Must support ESM module workers. Ensure your build supports `new URL(..., import.meta.url)` for assets and that module workers are enabled.

- **Next.js**: Use **client-only** code paths.
  - Add `"use client";` at the top of any file that imports `@mainframework/api-request-worker/react`.
  - Do not call `createApiWorker()` during SSR.
  - `useApiWorker` returns `null` when `window` is undefined — guard before destructuring in SSR or shared modules.

---

## Usage with Vanilla TypeScript / JavaScript

Import from the main package entry and create the worker with `createApiWorker`. You then talk to the worker via the standard `postMessage` API: send **dataRequests** with `worker.postMessage`, and handle responses in `worker.onmessage`. No framework required.

### Setting Up the Worker

Create the worker with `createApiWorker`. This is the only way to obtain the worker.

```ts
import { createApiWorker } from "@mainframework/api-request-worker";

const worker = createApiWorker();
```

Set `worker.onmessage` to handle responses (see [Message Protocol](#message-protocol)). Use the built-in `worker.postMessage` to send requests; do not overwrite `postMessage`.

### Message Protocol

**Outgoing messages (main thread → worker):**

Send a single object: `{ dataRequest: { ... } }`.

| dataRequest.type | Description                                         | Required fields | Optional                                    |
| ---------------- | --------------------------------------------------- | --------------- | ------------------------------------------- |
| `"get"`          | Return cached value for `cacheName`.                | `cacheName`     | `hookId`                                    |
| `"set"`          | Store payload and/or run API request, then respond. | `cacheName`     | `hookId`, `request`, `payload`, `requestId` |
| `"delete"`       | Remove cache entry for `cacheName`.                 | `cacheName`     | `hookId`                                    |
| `"cancel"`       | Abort in-flight request by `requestId`.             | —               | `requestId`                                 |

**Key fields:**

- **`cacheName`**: String; required for `get`, `set`, `delete`. Cache keys are normalized to lowercase.
- **`request`**: API request configuration (`url`, `method`, `headers`, `credentials`, `responseType`, etc.). Required for `set` when making an API call.
- **`payload`**: Request body for POST/PATCH requests. Required for `set` when there is no `request`, and for non-GET requests when `request` is provided.
- **`requestId`**: Optional for `set` (enables request cancellation); required for `cancel`.

**Incoming messages (worker → main thread):**

Every message includes:

- **`type`**: `"result"` | `"delete"` | `"stream"` — disambiguates delete acknowledgements from real payloads and stream events.
- **`requestId`**: Echoes the originating request when present; omitted for cache-only `get` / `delete` without a client `requestId`.
- **`error`**: `{ message: string; code?: WorkerErrorCode }` — always present.

- **Success**: `type: "result"`, `data` contains the response body, `error.message` is `""` (empty string).
- **Failure**: `type: "result"`, `data` is `null`, `error.message` contains the error description, optional `error.code` classifies the failure.
- **Delete ack**: `type: "delete"`, `data: null`, `error: { message: "" }` — the `type` field is the signal; there is no `{ deleted: true }` payload.

**Error codes (`error.code`):**

| Code           | When                                            |
| -------------- | ----------------------------------------------- |
| `"aborted"`    | Manual `cancel` or `AbortError` without timeout |
| `"timeout"`    | `timeoutMs` fired                               |
| `"http"`       | HTTP status ≥ 400                               |
| `"network"`    | Fetch, parse, or other runtime failure          |
| `"validation"` | Cache miss, invalid request, etc.               |

**Message formats:**

- **Success (JSON/text):** `{ type: "result", cacheName, data, error: { message: "" }, requestId?, hookId?, httpStatus? }`
- **Success (binary):** `{ type: "result", cacheName, data: ArrayBuffer, meta: { contentType?, contentDisposition }, error: { message: "" }, requestId?, hookId?, httpStatus? }`
- **Delete ack:** `{ type: "delete", cacheName, data: null, error: { message: "" }, requestId?, hookId? }`
- **Success (stream):** Multiple messages in sequence:
  - `{ type: "stream", cacheName, stream: "start", meta: { contentType?, contentDisposition }, requestId?, hookId?, httpStatus?, error: { message: "" } }`
  - `{ type: "stream", cacheName, stream: "chunk", data: ArrayBuffer, requestId?, hookId?, error: { message: "" } }` (one or more)
  - `{ type: "stream", cacheName, stream: "resume", meta: { contentType?, contentDisposition }, requestId?, hookId?, httpStatus?, error: { message: "" } }` (after retry)
  - `{ type: "stream", cacheName, stream: "end", requestId?, hookId?, error: { message: "" } }` (final message)
- **Error:** `{ type: "result", cacheName?, data: null, error: { message: "...", code?: "..." }, requestId?, hookId? }`. If the request had no `cacheName`, match by `hookId` instead.

**Design notes:**

| #   | Note                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | In-flight dedupe for json/text is keyed by `cacheName` only (not HTTP method). Two concurrent mutations on the same key coalesce — intentional for read caching; use distinct `cacheName` values for independent writes.      |
| 8   | `retries` applies only when `responseType: "stream"`.                                                                                                                                                                         |
| 9   | Auto-run refires when `data` / `request` object identity changes — callers must memoize inline literals.                                                                                                                      |
| 10  | `streamChunks` exposes the latest flushed batch (`ArrayBuffer[]`), not the cumulative stream — accumulate in consumer if needed.                                                                                              |
| 11  | Joiners on a deduped json/text fetch may receive **two** `type: "result"` messages: cached value immediately, then fresh value after the shared fetch completes. Vanilla consumers should handle or ignore the first message. |

**Joiner cancel:** Multiple subscribers sharing a `cacheName` coalesce into one in-flight fetch (json/text). Each caller registers its own `requestId`. Cancel removes only that `requestId`; the shared fetch is aborted only when the last registered `requestId` is cancelled. For `responseType: "binary"` or `"stream"`, in-flight tracking is keyed by `requestId` (not `cacheName`), so those requests do not dedupe across callers.

**Common error messages:**

- `"Invalid request: type is required"`
- `"Invalid request: cacheName is required"`
- `"Invalid request: payload is required for set"`
- `"Invalid request: payload is required for non-GET API request"`
- `"Cache miss"` (when requesting a non-existent cache key)
- HTTP status text or fetch error messages for network failures

### Request Configuration

```ts
interface RequestConfig {
  url: string;
  method: "GET" | "get" | "POST" | "post" | "PATCH" | "patch" | "DELETE" | "delete";
  mode?: "cors" | "no-cors" | "navigate" | "same-origin";
  headers?: Record<string, string>;
  credentials?: "include" | "same-origin" | "omit";
  responseType?: "json" | "binary" | "stream"; // default: "json"
  timeoutMs?: number; // Abort request after this many milliseconds
  formDataFileFieldName?: string; // FormData field name for File/Blob parts (default: "Files")
  formDataKey?: string; // FormData key for root payload when building multipart form data
  retries?: number; // For responseType "stream": retry attempts on connection loss (default: 3, max: 5)
  streamChunkBatchSize?: number; // For responseType "stream": flush to streamChunks every N chunks (default: 5)
}
```

- **`responseType: "binary"`**: Skips in-flight dedupe so each request fetches fresh data. Response parsing still follows `Content-Type`; when the server returns binary content, the worker sends an `ArrayBuffer` with `meta.contentType` and `meta.contentDisposition` so you can construct a `Blob`: `new Blob([data], { type: meta?.contentType })`.

- **`responseType: "stream"`**: Enables incremental chunk delivery. The hook exposes the latest flushed batch in `streamChunks` (`ArrayBuffer[]`) and a final `Blob` in `data` when complete. Batching via `streamChunkBatchSize` (default 5) controls how many chunks are delivered per update. Supports automatic reconnection with configurable retries (default 3, max 5).

- **`formDataFileFieldName`** (default `"Files"`): FormData field name for all `File`/`Blob` parts when the worker auto-builds multipart form data.

- **`formDataKey`** (default `"Files"`): FormData key for the root payload object when building multipart form data.

**File upload:** When a `set` payload contains `File` or `Blob` values (including nested in objects or arrays), the worker automatically sends the request as `multipart/form-data` and omits any caller `Content-Type` header so the browser sets the boundary. No manual `Content-Type: multipart/form-data` header is required.

### Vanilla JavaScript Examples

**GET request from API (JSON response):**

```ts
import { createApiWorker } from "@mainframework/api-request-worker";

const worker = createApiWorker();
const cacheName = "api-get-" + Date.now();

worker.onmessage = (event) => {
  const { cacheName: name, data, error, httpStatus } = event.data;
  if (name === cacheName && error?.message === "" && data != null) {
    console.log("Response:", data, "HTTP status:", httpStatus);
  }
};

worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName,
    request: { url: "https://api.example.com/data", method: "GET" },
    hookId: "vanilla-get",
  },
});
```

**POST request with JSON payload:**

```ts
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "api-post-" + Date.now(),
    payload: { name: "New Item", description: "Created from vanilla JS" },
    request: {
      url: "https://api.example.com/items",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    hookId: "vanilla-post",
  },
});
```

**POST request with file upload (auto multipart):**

```ts
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "upload-" + Date.now(),
    payload: { title: "My Photo", photos: [fileInput.files[0]] },
    request: {
      url: "https://api.example.com/upload",
      method: "POST",
      // No Content-Type header needed — worker detects File/Blob and sends multipart/form-data
    },
    hookId: "vanilla-upload",
  },
});
```

**PATCH request:**

```ts
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "update-item",
    payload: { status: "completed", priority: "high" },
    request: {
      url: "https://api.example.com/items/123",
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    },
    hookId: "vanilla-patch",
  },
});
```

**Cache-only operations (no API call):**

```ts
const cacheName = "local-cache-" + Math.random();

// Store data in cache without making an API request
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName,
    payload: { userId: 42, preferences: { theme: "dark" } },
    hookId: "cache-set",
  },
});

// Retrieve cached data
setTimeout(() => {
  worker.postMessage({
    dataRequest: { type: "get", cacheName, hookId: "cache-get" },
  });
}, 0);
// onmessage will receive: { cacheName, data: { userId: 42, preferences: { theme: "dark" } }, error: { message: "" } }
```

**Handling cache misses:**

```ts
worker.postMessage({
  dataRequest: { type: "get", cacheName: "nonexistent-key", hookId: "cache-miss" },
});
// onmessage receives: { type: "result", cacheName: "nonexistent-key", data: null, error: { message: "Cache miss", code: "validation" }, hookId: "cache-miss" }
```

**Delete cached data:**

```ts
// First, store some data
worker.postMessage({
  dataRequest: { type: "set", cacheName: "temp-data", payload: { temp: true } },
});

// Later, delete it
worker.postMessage({
  dataRequest: { type: "delete", cacheName: "temp-data", hookId: "delete-op" },
});
// Response: { type: "delete", cacheName: "temp-data", data: null, error: { message: "" }, hookId: "delete-op" }

// Subsequent get for the same cacheName returns: { error: { message: "Cache miss" } }
```

**Binary file download (complete file):**

```ts
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "download-pdf-" + Date.now(),
    request: {
      url: "https://example.com/document.pdf",
      method: "GET",
      responseType: "binary",
    },
    hookId: "binary-download",
  },
});

worker.onmessage = (event) => {
  const { data, meta, error } = event.data;
  if (error?.message === "" && data instanceof ArrayBuffer) {
    // Build a Blob from the ArrayBuffer
    const blob = new Blob([data], {
      type: meta?.contentType ?? "application/octet-stream",
    });

    // Create download link or object URL
    const url = URL.createObjectURL(blob);
    console.log("Download ready:", url);
  }
};
```

**Streaming audio/video (incremental chunks):**

```ts
const cacheName = "audio-stream-" + Date.now();
const chunks: ArrayBuffer[] = [];
let meta: { contentType?: string; contentDisposition: string | null } | null = null;

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.cacheName !== cacheName || msg.type !== "stream") return;

  if (msg.stream === "start") {
    // Stream started
    chunks.length = 0;
    meta = msg.meta ?? null;
    console.log("Stream started, content type:", meta?.contentType);
  } else if (msg.stream === "chunk" && msg.data) {
    // Received a chunk
    chunks.push(msg.data);
    console.log(`Received chunk, total chunks: ${chunks.length}`);
  } else if (msg.stream === "resume") {
    // Stream resumed after reconnection
    if (msg.meta) meta = msg.meta;
    console.log("Stream resumed");
  } else if (msg.stream === "end") {
    // Stream complete
    if (msg.error?.message === "" && chunks.length > 0) {
      const blob = new Blob(chunks, meta?.contentType ? { type: meta.contentType } : undefined);
      const url = URL.createObjectURL(blob);
      console.log("Stream complete, blob URL:", url);

      // Use the URL in an audio or video element
      // audioElement.src = url;
    } else {
      console.error("Stream error:", msg.error?.message);
    }
  }
};

worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName,
    request: {
      url: "https://stream.example.com/audio.mp3",
      method: "GET",
      responseType: "stream",
      retries: 3, // Retry up to 3 times on connection loss
    },
    hookId: "stream-audio",
  },
});
```

**Cancel an in-flight request:**

```ts
const requestId = "cancel-request-" + Date.now();

// Start a large download
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "large-file",
    request: {
      url: "https://example.com/large-file.bin",
      method: "GET",
      responseType: "binary",
    },
    requestId,
  },
});

// Cancel it after 100ms
setTimeout(() => {
  worker.postMessage({
    dataRequest: { type: "cancel", requestId },
  });
}, 100);
```

**Handling validation errors:**

```ts
// Missing type
worker.postMessage({ dataRequest: { cacheName: "x" } });
// Response: { error: { message: "Invalid request: type is required" } }

// Missing cacheName
worker.postMessage({ dataRequest: { type: "get" } });
// Response: { error: { message: "Invalid request: cacheName is required" } }

// Missing payload for set
worker.postMessage({ dataRequest: { type: "set", cacheName: "k" } });
// Response: { error: { message: "Invalid request: payload is required for set" } }

// Missing payload for POST
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "k",
    request: { url: "...", method: "POST" },
  },
});
// Response: { error: { message: "Invalid request: payload is required for non-GET API request" } }
```

---

## Usage with React

For React applications, the library provides an optional `useApiWorker` hook that wraps the worker communication. You may use this hook or build your own React integration using the [Message Protocol](#message-protocol) above. No provider or wrapper component is required—use the hook wherever you need to fetch or read cached data.

### Hook API

```ts
import { useApiWorker } from "@mainframework/api-request-worker/react";

const result = useApiWorker({
  cacheName: "my-cache",       // required
  request: { ... },            // optional: request config for API call
  data: { ... },               // optional: payload for POST/PATCH
  runMode: "auto",             // optional: "auto" | "manual" | "once" (default "auto")
  enabled: true,               // optional: if false, no request is sent (default true)
});

// result: UseApiWorkerReturn<T> | null — null when window is undefined (SSR)
// { data, meta, loading, error, errorCode, refetch, deleteCache, streamChunks? }
```

**Parameters:**

- **`cacheName`** (required): Cache key for storing and retrieving data. Multiple components using the same `cacheName` share the same cached value (see [Shared cacheName](#shared-cachename--multiple-subscribers)).
- **`request`** (optional): When provided, the worker performs an API request and stores the result. When omitted, the hook only reads from cache.
- **`data`** (optional): Request body/payload for POST, PATCH, etc.
- **`runMode`**:
  - **`"auto"`** (default): Sends the request (or cache read) immediately when the hook mounts.
  - **`"manual"`**: Does not send automatically; call `refetch()` to trigger.
  - **`"once"`**: Sends once automatically on mount; subsequent `refetch()` calls do nothing.
- **`enabled`**: When `false`, no request is sent (useful for conditional fetching based on user state or other conditions).

**Return value:**

| Property       | Type                         | Description                                                                                                                                     |
| -------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`         | `T \| null`                  | Response body: JSON/text or `ArrayBuffer` per server `Content-Type`; `Blob` when `responseType: "stream"` completes.                            |
| `meta`         | `BinaryResponseMeta \| null` | For binary and stream responses: `contentType`, `contentDisposition`.                                                                           |
| `loading`      | `boolean`                    | `true` while a request is in flight.                                                                                                            |
| `error`        | `string \| null`             | Error message when the request failed; `null` when there is no error. See [Errors](#errors).                                                    |
| `errorCode`    | `WorkerErrorCode \| null`    | Structured error classification (`"aborted"`, `"timeout"`, `"http"`, `"network"`, `"validation"`); `null` when there is no error.               |
| `refetch`      | `() => void`                 | Re-runs the same logical request. See [Refetch semantics](#refetch-semantics).                                                                  |
| `deleteCache`  | `() => void`                 | Tells the worker to delete the cache entry for this `cacheName`.                                                                                |
| `streamChunks` | `ArrayBuffer[] \| undefined` | For `responseType: "stream"`: the latest flushed batch of chunks. Append to `MediaSource` or process incrementally. `undefined` for non-stream. |

### React Examples

**GET request with automatic execution:**

```ts
const { data, loading, error, refetch, deleteCache } = useApiWorker({
  cacheName: "todos",
  request: { url: "https://api.example.com/todos", method: "GET" },
  runMode: "auto",
});

// Request is sent immediately when component mounts
// data/loading/error update when the worker responds
```

**POST request with payload:**

```ts
const { data, loading, error, refetch } = useApiWorker({
  cacheName: "create-post",
  request: {
    url: "https://api.restful-api.dev/objects",
    method: "POST",
    headers: { "Content-Type": "application/json" },
  },
  data: {
    name: "My New Object",
    data: { color: "blue", size: "large" },
  },
  runMode: "auto",
});
```

**PATCH request:**

```ts
const { data, loading, refetch } = useApiWorker({
  cacheName: "update-item",
  request: {
    url: "https://api.example.com/items/123",
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
  },
  data: { status: "completed", updatedAt: new Date().toISOString() },
  runMode: "auto",
});
```

**Manual execution (lazy loading):**

```ts
const { data, loading, refetch } = useApiWorker({
  cacheName: "user-profile",
  request: {
    url: "https://api.example.com/profile",
    method: "GET",
  },
  runMode: "manual",
});

// Call refetch() when needed (e.g., on button click or in useEffect)
const handleLoadProfile = () => {
  refetch();
};
```

**Run once (single automatic execution):**

```ts
const { data, refetch } = useApiWorker({
  cacheName: "init-data",
  request: { url: "https://api.example.com/init", method: "GET" },
  runMode: "once",
});
// Request is sent once on mount. Calling refetch() does nothing.
```

**Conditional fetching:**

```ts
const { data, loading } = useApiWorker({
  cacheName: "protected-resource",
  request: { url: "https://api.example.com/protected", method: "GET" },
  runMode: "auto",
  enabled: isAuthenticated, // Only fetch when user is authenticated
});
```

**Read from cache only (no API request):**

```ts
const { data, loading, error, refetch } = useApiWorker({
  cacheName: "shared-state",
  runMode: "auto",
});
// Sends a "get" request to the worker
// If cache is empty, error will be "Cache miss"
```

**Binary response (complete file):**

```ts
const { data, meta, loading } = useApiWorker({
  cacheName: "pdf-document",
  request: {
    url: "https://example.com/document.pdf",
    method: "GET",
    responseType: "binary",
  },
  runMode: "auto",
});

// When loaded, data is ArrayBuffer
// meta contains contentType and contentDisposition
// Create a Blob: new Blob([data], { type: meta?.contentType })
// Create object URL: URL.createObjectURL(blob)
```

**Streaming response (audio/video):**

```ts
const { data, meta, loading, error, streamChunks } = useApiWorker({
  cacheName: "video-stream",
  request: {
    url: "https://example.com/video.mp4",
    method: "GET",
    responseType: "stream",
    retries: 3, // Retry on connection loss (default 3, max 5)
    streamChunkBatchSize: 5, // Optional: flush every N chunks (default 5)
  },
  runMode: "auto",
});

// streamChunks: latest flushed batch (ArrayBuffer[]) as chunks arrive (append to MediaSource, etc.)
// data: Blob when the stream completes
// loading: true until stream ends
// const videoUrl = data ? URL.createObjectURL(data) : null;
// <video src={videoUrl} controls />
```

**Delete cache:**

```ts
const { data, deleteCache } = useApiWorker({
  cacheName: "temporary-data",
  request: { url: "https://api.example.com/temp", method: "GET" },
  runMode: "manual",
});

const handleClearCache = () => {
  deleteCache(); // Removes the cache entry from the worker
};
```

### Shared cacheName / Multiple Subscribers

When multiple components use the same `cacheName`, they share a single client queue entry and a single worker cache key. All mounted subscribers register on that entry; when the worker responds, **all subscribers re-render** with the same `data`, `loading`, and `error` state.

**Recommendation:** Use distinct `cacheName` values when components need independent state, different `request` configs, or separate `loading`/`error` tracking.

**Unmount cancel:** When a component unmounts, its in-flight `requestId` is cancelled only if it is the last subscriber for that `cacheName`. Other subscribers keep the shared fetch alive.

### Refetch Semantics

`refetch()` re-runs the same logical operation as the current hook configuration:

- **When `request` is omitted**: Sends a **get** request (reads from cache)
- **When `request` is provided**: Sends a **set** request (makes an API call or stores data)

It does not switch between get and set based on prior runs; it uses the current `cacheName`, `request`, and `data` values at the time `refetch()` is called.

### Errors

The worker always includes an `error` field in every message: `{ message: string; code?: WorkerErrorCode }`.

- **No error**: `{ message: "" }` (empty string)
- **Error occurred**: `{ message: "error description", code?: "aborted" | "timeout" | "http" | "network" | "validation" }`

The hook exposes this as `error: string | null` and `errorCode: WorkerErrorCode | null`:

- `null` when `error.message` is empty
- The error message string when an error occurred
- `errorCode` mirrors `error.code` when present

Common error messages:

- `"Cache miss"` – Requested cache key doesn't exist
- `"Invalid request: ..."` – Request validation failed
- HTTP status text or network error messages

Responses are routed to the requesting component by `cacheName` or, when `cacheName` is missing from the worker response, by `hookId`.

---

## TypeScript Types

**Vanilla (main entry):** Request and protocol types:

```ts
import type {
  RequestConfig,
  DataRequest,
  BinaryResponseMeta,
  WorkerMessagePayload,
  WorkerErrorPayload,
  WorkerErrorCode,
  WorkerResponseType,
  WorkerResponseMessage,
  ResponseType,
  RunMode,
  WorkerDataRequestType,
  WorkerMessageData,
  BinaryParseResult,
} from "@mainframework/api-request-worker";
```

- `WorkerDataRequestType`: `"get" | "set" | "delete" | "cancel"` — for narrowing `DataRequest.type`
- `WorkerMessageData`: `{ dataRequest?: DataRequest }` — shape for `postMessage` payloads
- `BinaryParseResult`: internal binary marker type; mainly for advanced worker extensions

**React:**

```ts
import type { RequestConfig, UseApiWorkerConfig, UseApiWorkerReturn } from "@mainframework/api-request-worker/react";
```

---

## Quick Reference

| Use case          | Entry point                               | Primary API                                                                                                                                                                                       |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vanilla JS/TS** | `@mainframework/api-request-worker`       | `createApiWorker()`; set `worker.onmessage`, use `worker.postMessage`                                                                                                                             |
| **React**         | `@mainframework/api-request-worker/react` | `useApiWorker({ cacheName, request?, data?, runMode?, enabled? })` → `UseApiWorkerReturn<T> \| null` (`data`, `meta`, `loading`, `error`, `errorCode`, `refetch`, `deleteCache`, `streamChunks?`) |

---

## Framework Integrations

**Core:** The worker and message protocol work in any environment (vanilla JavaScript/TypeScript or any framework). The worker is always created via `createApiWorker`; the vanilla bundle and the React hook both use it.

**React:** A hook (`useApiWorker`) is included; it uses `createApiWorker` internally and exposes a simple API. You can instead use the [Message Protocol](#message-protocol) from React with your own `createApiWorker()` instance.

**Other frameworks:** Use the main package entry and the protocol as with vanilla JS (Angular, Vue, Preact, SolidJS, etc.).

---

## Changelog

### 1.1.0

- Added `type` and `requestId` to all worker→main messages for protocol disambiguation and request correlation.
- Added structured `error.code` (`WorkerErrorCode`) alongside existing `error.message`.
- Delete responses now use `type: "delete"` with `data: null` instead of `{ deleted: true }` — **breaking** for consumers relying on the old delete payload shape.
- Joiner-aware cancel: shared in-flight fetches track multiple `requestId`s; abort only when the last subscriber cancels.
- Last-activity eviction for idle queue entries (client) and cache store entries (worker).
- Stream `responseType` detection in the React hook now uses `toLocaleLowerCase()` consistently (was `toLowerCase()`).

---

## License

See LICENSE in the repository.
