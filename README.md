# @mainframework/api-reqpuest-provider-worker-hook

**Requires Node.js 18+** (for global `fetch` when running in Node; browsers rely on their native fetch).

A library that moves API calls and cache storage off the main thread using a Web Worker. It can be used **with React** (via the `useApiWorker` hook) or **with vanilla TypeScript/JavaScript** (by talking to the worker with `postMessage`).

---

## Note: Version 1.x is deprecated

Please use the current API described below when upgrading from 1.x.

---

## Download and streaming behavior

Responses are **all-or-nothing**: the worker does **not** stream incrementally. For each request, the full response body (JSON, text, or binary) is buffered in the worker and then sent to the client in a single message. The client does not receive data until the entire response has been received. For large files (e.g. audio or video from a single URL), playback cannot start until the full file has been downloaded.

---

## Installation

```bash
npm i @mainframework/api-reqpuest-provider-worker-hook
# or
yarn add @mainframework/api-reqpuest-provider-worker-hook
```

**React:** peer dependency `react >= 19` is required when using the hook.

---

## Usage with React

Everything is driven by the `useApiWorker` hook—no provider or wrapper required. Use the hook wherever you need to fetch or read cached data.

### Hook API

```ts
import { useApiWorker } from "@mainframework/api-reqpuest-provider-worker-hook";

const result = useApiWorker({
  cacheName: "my-cache",       // required
  request: { ... },            // optional: request config for API call
  data: { ... },               // optional: payload for POST/PATCH
  runMode: "auto",             // optional: "auto" | "manual" | "once" (default "auto")
  enabled: true,               // optional: if false, no request is sent (default true)
});

// result: { data, meta, loading, error, refetch, deleteCache }
```

- **`cacheName`** (required): Key used to store and retrieve data. Same cache name in different components shares the same cached value (see [Shared cacheName](#shared-cachename--multiple-subscribers)).
- **`request`** (optional): When provided, the worker performs an API request and stores the result under `cacheName`. When omitted, the worker only reads from cache (or returns cache miss).
- **`data`** (optional): Body/payload for POST, PATCH, etc. Passed as `payload` to the worker.
- **`runMode`**:
  - **`"auto"`** (default): Sends the request (or get) as soon as the hook runs.
  - **`"manual"`**: Does not send automatically; call `refetch()` to send.
  - **`"once"`**: Sends once automatically; `refetch()` does not send again.
- **`enabled`**: When `false`, no request is sent (useful for conditional fetching).

**Return value:**

| Property      | Type                         | Description                                                                                                                                                                                                                            |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`        | `T \| null`                  | Response body (JSON, text, or `ArrayBuffer` for binary).                                                                                                                                                                               |
| `meta`        | `BinaryResponseMeta \| null` | For binary responses: `contentType`, `contentDisposition`.                                                                                                                                                                             |
| `loading`     | `boolean`                    | `true` while a request is in flight.                                                                                                                                                                                                   |
| `error`       | `string \| null`             | Error message from the worker when the request failed; `null` when there is no error. The worker always sends an `error` field (`{ message: string }`); the hook exposes the message string or `null`. See [Errors](#errors).          |
| `refetch`     | `() => void`                 | Re-runs the same logical request as the current config (get when there is no `request`, set when there is). No-op when `runMode === "once"` and already run, or when `enabled === false`. See [Refetch semantics](#refetch-semantics). |
| `deleteCache` | `() => void`                 | Tells the worker to delete the cache entry for this `cacheName`.                                                                                                                                                                       |

### Request config (for `request`)

```ts
interface RequestConfig {
  url: string;
  method: "GET" | "get" | "POST" | "post" | "PATCH" | "patch" | "DELETE" | "delete";
  mode?: "cors" | "no-cors" | "navigate" | "same-origin";
  headers?: Record<string, string>;
  credentials?: "include" | "same-origin" | "omit";
  responseType?: "json" | "binary" | "stream"; // default: json
}
```

- Use **`responseType: "binary"`** when the response is binary (e.g. audio/video). The worker returns an `ArrayBuffer` and sets `meta.contentType` (and `contentDisposition`) so you can build a `Blob` for playback.

### React examples (aligned with tests)

**GET request, auto-run:**

```ts
const { data, loading, refetch, deleteCache } = useApiWorker({
  cacheName: "todos",
  request: { url: "https://example.com/api", method: "GET" },
  runMode: "auto",
});
// Request is sent immediately. data/loading update when the worker responds.
```

**POST request with payload:**

```ts
const { data, loading, refetch } = useApiWorker({
  cacheName: "posts",
  request: {
    url: "https://api.restful-api.dev/objects",
    method: "POST",
    headers: { "Content-Type": "application/json" },
  },
  data: { name: "Worker test object", data: { source: "app", env: "prod" } },
  runMode: "auto",
});
```

**PATCH request:**

```ts
const { data, refetch } = useApiWorker({
  cacheName: "patch-item",
  request: {
    url: "https://api.restful-api.dev/objects/6",
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
  },
  data: { data: { price: 99, note: "updated" } },
  runMode: "auto",
});
```

**Manual run (lazy request):**

```ts
const { data, loading, refetch } = useApiWorker({
  cacheName: "cats",
  request: { url: "https://api.thecatapi.com/v1/images/search?limit=10", method: "GET" },
  runMode: "manual",
});
// Call refetch() in an effect or on click to send the request.
useEffect(() => {
  refetch();
}, []);
```

**Run once (single auto-run, refetch does not re-send):**

```ts
const { data, refetch } = useApiWorker({
  cacheName: "once-key",
  request: { url: "https://example.com/api", method: "GET" },
  runMode: "once",
});
// Request is sent once. Calling refetch() does not send again.
```

**Disabled (no request sent):**

```ts
const { data } = useApiWorker({
  cacheName: "disabled-key",
  request: { url: "https://example.com/api", method: "GET" },
  runMode: "auto",
  enabled: false,
});
// No postMessage is sent to the worker.
```

**Read from cache only (no request):**

```ts
const { data, loading, refetch } = useApiWorker({
  cacheName: "cats",
  runMode: "auto",
});
// Sends a "get" dataRequest; if cache is empty, worker responds with error.message e.g. "Cache miss".
```

**Binary response (e.g. audio/video):**

```ts
const { data, meta } = useApiWorker({
  cacheName: "audio",
  request: {
    url: "https://httpbin.org/bytes/128",
    method: "GET",
    responseType: "binary",
  },
  runMode: "auto",
});
// data is ArrayBuffer; meta has contentType/contentDisposition for new Blob([data], { type: meta?.contentType }).
```

**Delete cache:**

```ts
const { deleteCache } = useApiWorker({
  cacheName: "temp",
  request: { url: "https://example.com/api", method: "GET" },
  runMode: "manual",
});
deleteCache(); // Sends delete dataRequest to the worker.
```

### Shared cacheName / multiple subscribers

When multiple components use the same `cacheName`, they share one cache entry. Only one queue entry exists per normalized cache name; the last-mounted component’s `setUpdateTrigger` is the one that receives updates, so only that component re-renders when the worker responds. Prefer a unique `cacheName` per logical resource if you need independent loading/error state per component.

### Refetch semantics

`refetch()` re-runs the same logical operation as the current config: a **get** when `request` is omitted (read from cache), or a **set** (API request or cache-only) when `request` is provided. It does not switch between get and set based on prior runs; it uses the current `cacheName`, `request`, and `data` at call time.

### Errors

The worker always sends an `error` field on every message: `{ message: string }`. No error = `{ message: "" }`; when the request failed = `{ message: "..." }` (e.g. `"Cache miss"`, `"Invalid request: type is required"`, HTTP status text, or network/abort messages). The hook exposes this as `error: string | null` (the message string or `null` when `message` is empty). You can watch `error` in render or an effect to handle failures. Responses are routed to the requesting entry by `cacheName` or, when `cacheName` is missing, by `hookId`.

---

## Usage with Vanilla TypeScript / JavaScript

Without React, you use the same Web Worker and message protocol. You create a Worker from the package’s built worker script, then send **dataRequests** via `postMessage` and handle responses in `onmessage`.

### Worker script location

- **Bundler (Vite, webpack, etc.):** Use the worker entry from the package. For example with Vite:
  ```ts
  const worker = new Worker(
    new URL("node_modules/@mainframework/api-reqpuest-provider-worker-hook/dist/api.worker.js", import.meta.url),
    { type: "module" },
  );
  ```
  Or with a package that resolves the worker URL (e.g. `?worker` or `?url`), point that at the package’s `dist/api.worker.js`.
- **No bundler:** Serve `node_modules/@mainframework/api-reqpuest-provider-worker-hook/dist/api.worker.js` and create the worker with that URL.

### Message protocol

**Outgoing (main thread → worker):**

Send a single object: `{ dataRequest: { ... } }`.

| dataRequest.type | Description                                         | Required fields | Optional                                    |
| ---------------- | --------------------------------------------------- | --------------- | ------------------------------------------- |
| `"get"`          | Return cached value for `cacheName`.                | `cacheName`     | `hookId`                                    |
| `"set"`          | Store payload and/or run API request, then respond. | `cacheName`     | `hookId`, `request`, `payload`, `requestId` |
| `"delete"`       | Remove cache entry for `cacheName`.                 | `cacheName`     | `hookId`                                    |
| `"cancel"`       | Abort in-flight request by `requestId`.             | —               | `requestId`                                 |

- **`cacheName`**: String; required for `get`, `set`, `delete`. Stored keys are normalized to lowercase.
- **`request`**: Same shape as React’s `RequestConfig` (`url`, `method`, `headers`, `credentials`, `responseType`, etc.). Required for `set` when you want an API call; optional for cache-only set.
- **`payload`**: Body for POST/PATCH; required for `set` when there is no `request`, and for non-GET requests when `request` is provided.
- **`requestId`**: Optional for `set` (enables cancellation); required for `cancel`.

**Incoming (worker → main thread):**

Every message includes `error: { message: string }`. Success: `data` has the body and `error.message` is `""`. Failure: `data` is `null` and `error.message` is the error text.

- **Success (JSON/text):** `{ cacheName, data, error: { message: "" }, hookId?, httpStatus? }`
- **Success (binary):** `{ cacheName, data: ArrayBuffer, meta: { contentType?, contentDisposition }, error: { message: "" }, hookId?, httpStatus? }`
- **Error:** `{ cacheName?, data: null, error: { message: "..." }, hookId? }`. When the request had no `cacheName` (e.g. validation before cacheName is set), `cacheName` may be empty; match by `hookId`.

Example messages:

- **Validation:** e.g. `"Invalid request: type is required"`, `"Invalid request: cacheName is required"`, `"Invalid request: payload is required for set"`, `"Invalid request: payload is required for non-GET API request"`.
- **Cache miss:** `"Cache miss"` when `get` is sent for a key with no cached value.
- **HTTP/network/abort:** status text or fetch error message.

### Vanilla examples (aligned with api.worker tests)

**GET from API and receive JSON:**

```ts
const worker = new Worker(workerUrl, { type: "module" });
const cacheName = "api-get-" + Date.now();

worker.onmessage = (event) => {
  const { cacheName: name, data, error, httpStatus } = event.data;
  if (name === cacheName && error?.message === "" && data != null) {
    console.log("Response:", data, "status:", httpStatus);
  }
};

worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName,
    request: { url: "https://example.com/api", method: "GET" },
    hookId: "h1",
  },
});
```

**POST with payload:**

```ts
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "api-post-" + Date.now(),
    payload: { name: "test" },
    request: {
      url: "https://example.com/api",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    hookId: "h1",
  },
});
```

**Cache-only set, then get:**

```ts
const cacheName = "set-cache-only-" + Math.random();

worker.postMessage({
  dataRequest: { type: "set", cacheName, payload: { a: 1, b: 2 }, hookId: "h1" },
});

// After a tick, request the value back
setTimeout(() => {
  worker.postMessage({ dataRequest: { type: "get", cacheName } });
}, 0);
// onmessage will receive { cacheName, data: { a: 1, b: 2 } }
```

**Get when key is missing (CACHE_MISS):**

```ts
worker.postMessage({
  dataRequest: { type: "get", cacheName: "nonexistent-key", hookId: "h1" },
});
// onmessage: { cacheName: "nonexistent-key", data: null, error: { message: "Cache miss" }, hookId: "h1" }
```

**Delete cache:**

```ts
worker.postMessage({ dataRequest: { type: "set", cacheName: "delete-key", payload: { keep: true } } });
// then
worker.postMessage({ dataRequest: { type: "delete", cacheName: "delete-key", hookId: "h1" } });
// Response: { cacheName: "delete-key", data: { deleted: true }, error: { message: "" }, hookId: "h1" }
// Subsequent get for same cacheName returns error: { message: "Cache miss" }.
```

**Binary response (e.g. GET bytes):**

```ts
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "httpbin-bytes-" + Date.now(),
    request: {
      url: "https://httpbin.org/bytes/128",
      method: "GET",
      responseType: "binary",
    },
  },
});
// onmessage: data is ArrayBuffer, meta has contentType (e.g. application/octet-stream).
// Build Blob: new Blob([event.data.data], { type: event.data.meta?.contentType ?? "application/octet-stream" })
```

**Cancel in-flight request:**

```ts
const requestId = "cancel-req-" + Date.now();
worker.postMessage({
  dataRequest: {
    type: "set",
    cacheName: "large-cancel",
    request: { url: "https://httpbin.org/bytes/50000", method: "GET", responseType: "binary" },
    requestId,
  },
});
setTimeout(() => {
  worker.postMessage({ dataRequest: { type: "cancel", requestId } });
}, 100);
```

**Validation errors (missing type, cacheName, or payload):**

- `{ type: "", cacheName: "x" }` → worker responds with `error: { message: "Invalid request: type is required" }`.
- `{ type: "get" }` (no cacheName) → `error: { message: "Invalid request: cacheName is required" }`.
- `{ type: "set", cacheName: "valid-key" }` (no payload, no request) → `error: { message: "Invalid request: payload is required for set" }`.
- `{ type: "set", cacheName: "k", request: { url: "...", method: "POST" } }` (no payload) → `error: { message: "Invalid request: payload is required for non-GET API request" }`.

---

## Types (TypeScript)

When using React you can import:

```ts
import type {
  RequestConfig,
  UseApiWorkerConfig,
  UseApiWorkerReturn,
} from "@mainframework/api-reqpuest-provider-worker-hook";
```

For vanilla usage, the worker expects the `dataRequest` shape described above; you can define a minimal type for the message payload or reuse the same `RequestConfig` for the `request` field.

---

## Summary

| Use case          | Entry                            | Main API                                                                                                                    |
| ----------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **React**         | `useApiWorker` from the package  | `useApiWorker({ cacheName, request?, data?, runMode?, enabled? })` → `{ data, meta, loading, error, refetch, deleteCache }` |
| **Vanilla TS/JS** | Worker from `dist/api.worker.js` | `worker.postMessage({ dataRequest: { type: "get"\|"set"\|"delete"\|"cancel", ... } })` and `worker.onmessage` for responses |

The instructions and examples above mirror the behavior covered by the package’s React hook tests (`useApiWorker.test.ts`) and worker tests (`api.worker.test.ts`).
