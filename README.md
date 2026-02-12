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

The library supports three response types to handle different use cases:

- **`responseType: "json"`** (default): Full response is buffered in the worker and sent to the client in a single message. The client receives the complete response (JSON or text) after the entire download completes.

- **`responseType: "binary"`**: Full binary response is buffered in the worker and sent as an `ArrayBuffer` in a single message. Perfect for complete binary files like images, PDFs, or downloadable documents.

- **`responseType: "stream"`**: Responses are streamed incrementally to the client. The worker sends chunks as they arrive (`start` → `chunk` → `chunk` → ... → `end`), enabling playback of audio/video streams to begin before the full file downloads. The React hook automatically accumulates chunks and returns a `Blob` when complete. For vanilla JavaScript, you handle stream events manually for maximum control.

Binary and stream responses are not stored in the worker cache; only json/text responses are cached.

---

## Installation

```bash
npm i @mainframework/api-request-worker
# or
yarn add @mainframework/api-request-worker
```

If you use the optional React hook, a peer dependency `react >= 19` is required.

---

## Usage with Vanilla TypeScript / JavaScript

The core of this library is a Web Worker that you communicate with via the standard `postMessage` API. This approach works in any JavaScript environment—no framework required. You create a Worker instance from the package's built worker script, send **dataRequests** via `postMessage`, and handle responses in `onmessage`.

### Setting Up the Worker

**With a bundler (Vite, webpack, etc.):**

```ts
const worker = new Worker(
  new URL("node_modules/@mainframework/api-request-worker/dist/api.worker.js", import.meta.url),
  { type: "module" },
);
```

**Without a bundler:**

Serve `node_modules/@mainframework/api-request-worker/dist/api.worker.js` from your web server and create the worker with that URL:

```ts
const worker = new Worker("/path/to/api.worker.js", { type: "module" });
```

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

Every message includes `error: { message: string }`.

- **Success**: `data` contains the response body and `error.message` is `""` (empty string).
- **Failure**: `data` is `null` and `error.message` contains the error description.

**Message formats:**

- **Success (JSON/text):** `{ cacheName, data, error: { message: "" }, hookId?, httpStatus? }`
- **Success (binary):** `{ cacheName, data: ArrayBuffer, meta: { contentType?, contentDisposition }, error: { message: "" }, hookId?, httpStatus? }`
- **Success (stream):** Multiple messages in sequence:
  - `{ cacheName, stream: "start", meta: { contentType?, contentDisposition }, hookId?, httpStatus?, error: { message: "" } }`
  - `{ cacheName, stream: "chunk", data: ArrayBuffer, hookId?, error: { message: "" } }` (one or more)
  - `{ cacheName, stream: "resume", meta: { contentType?, contentDisposition }, hookId?, httpStatus?, error: { message: "" } }` (after retry)
  - `{ cacheName, stream: "end", hookId?, error: { message: "" } }` (final message)
- **Error:** `{ cacheName?, data: null, error: { message: "..." }, hookId? }`. If the request had no `cacheName`, match by `hookId` instead.

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
}
```

- **`responseType: "binary"`**: Use for complete binary files. The worker returns an `ArrayBuffer` and sets `meta.contentType` and `meta.contentDisposition` so you can construct a proper `Blob`: `new Blob([data], { type: meta?.contentType })`.

- **`responseType: "stream"`**: Use for streaming audio/video or large files. The worker sends chunks incrementally. Supports automatic reconnection with configurable retries (default 3, max 5).

### Vanilla JavaScript Examples

**GET request from API (JSON response):**

```ts
const worker = new Worker(workerUrl, { type: "module" });
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
// onmessage receives: { cacheName: "nonexistent-key", data: null, error: { message: "Cache miss" }, hookId: "cache-miss" }
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
// Response: { cacheName: "temp-data", data: { deleted: true }, error: { message: "" }, hookId: "delete-op" }

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
  if (msg.cacheName !== cacheName) return;

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
import { useApiWorker } from "@mainframework/api-request-worker";

const result = useApiWorker({
  cacheName: "my-cache",       // required
  request: { ... },            // optional: request config for API call
  data: { ... },               // optional: payload for POST/PATCH
  runMode: "auto",             // optional: "auto" | "manual" | "once" (default "auto")
  enabled: true,               // optional: if false, no request is sent (default true)
});

// result: { data, meta, loading, error, refetch, deleteCache }
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

| Property      | Type                         | Description                                                                                                                           |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `data`        | `T \| null`                  | Response body: JSON/text for `responseType: "json"`, `ArrayBuffer` for `responseType: "binary"`, `Blob` for `responseType: "stream"`. |
| `meta`        | `BinaryResponseMeta \| null` | For binary and stream responses: `contentType`, `contentDisposition`.                                                                 |
| `loading`     | `boolean`                    | `true` while a request is in flight.                                                                                                  |
| `error`       | `string \| null`             | Error message when the request failed; `null` when there is no error. See [Errors](#errors).                                          |
| `refetch`     | `() => void`                 | Re-runs the same logical request. See [Refetch semantics](#refetch-semantics).                                                        |
| `deleteCache` | `() => void`                 | Tells the worker to delete the cache entry for this `cacheName`.                                                                      |

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
const { data, meta, loading, error } = useApiWorker({
  cacheName: "video-stream",
  request: {
    url: "https://example.com/video.mp4",
    method: "GET",
    responseType: "stream",
    retries: 3, // Retry on connection loss (default 3, max 5)
  },
  runMode: "auto",
});

// data is a Blob when the stream completes
// loading is true until stream ends
// Use with media elements:
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

When multiple components use the same `cacheName`, they share a single cache entry in the worker. However, only one queue entry exists per normalized cache name, and the last-mounted component's state updater receives the worker's responses. This means only that component will re-render when the worker responds.

**Recommendation:** Use unique `cacheName` values per logical resource if you need independent `loading`/`error` state in each component.

### Refetch Semantics

`refetch()` re-runs the same logical operation as the current hook configuration:

- **When `request` is omitted**: Sends a **get** request (reads from cache)
- **When `request` is provided**: Sends a **set** request (makes an API call or stores data)

It does not switch between get and set based on prior runs; it uses the current `cacheName`, `request`, and `data` values at the time `refetch()` is called.

### Errors

The worker always includes an `error` field in every message: `{ message: string }`.

- **No error**: `{ message: "" }` (empty string)
- **Error occurred**: `{ message: "error description" }`

The hook exposes this as `error: string | null`:

- `null` when `error.message` is empty
- The error message string when an error occurred

Common error messages:

- `"Cache miss"` – Requested cache key doesn't exist
- `"Invalid request: ..."` – Request validation failed
- HTTP status text or network error messages

Responses are routed to the requesting component by `cacheName` or, when `cacheName` is missing from the worker response, by `hookId`.

---

## TypeScript Types

**For React:**

```ts
import type { RequestConfig, UseApiWorkerConfig, UseApiWorkerReturn } from "@mainframework/api-request-worker";
```

**For vanilla JavaScript/TypeScript:**

The worker expects the `dataRequest` shape described in the protocol documentation above. You can define minimal types for message payloads or reuse `RequestConfig` for the `request` field.

---

## Quick Reference

| Use case          | Entry point                      | Primary API                                                                                                                                                |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vanilla JS/TS** | Worker from `dist/api.worker.js` | `worker.postMessage({ dataRequest: { type, cacheName, request?, payload?, ... } })` and `worker.onmessage` for responses                                   |
| **React**         | Optional: `useApiWorker` hook    | `useApiWorker({ cacheName, request?, data?, runMode?, enabled? })` → `{ data, meta, loading, error, refetch, deleteCache }` (or use worker protocol above) |

---

## Framework Integrations

**Core:** The worker and message protocol work with any environment (vanilla JavaScript/TypeScript or any framework).

**Optional integration:** A React hook (`useApiWorker`) is included to make adoption easier for React projects; React teams may instead integrate using the worker protocol directly.

**Coming soon:** Idiomatic helpers for other frameworks (Angular, Vue, Preact, SolidJS) are planned; until then, use the protocol from those frameworks as with vanilla JS.

---

## Testing

This library is thoroughly tested with comprehensive test suites:

- React hook tests (`useApiWorker.test.ts`)
- Worker protocol tests (`api.worker.test.ts`)

Key behaviors and examples in this README are covered by the test suites.

---

## License

See the License file in the repo
