/// <reference lib="webworker" />

import type {
  BinaryParseResult,
  BinaryResponseMeta,
  DataRequest,
  WorkerApiRequest,
  WorkerErrorCode,
  WorkerErrorPayload,
  WorkerMessageData,
} from "../../types/types";

export const BINARY_MARKER = Symbol.for("WorkerApiBinary");

const DEFAULT_FILES_FIELD = "Files";
const EMPTY_BUFFER = new ArrayBuffer(0);
const NO_ERROR: WorkerErrorPayload = { message: "" };
const DEFAULT_ERROR = "An error occurred";

const callerResponse = (
  cacheName: string,
  data: unknown,
  hookId?: string | null,
  httpStatus?: number,
  error: WorkerErrorPayload = NO_ERROR,
  type: "result" | "delete" = "result",
  requestId?: string | null,
): void => {
  self.postMessage({
    type,
    ...(requestId != null && requestId !== "" && { requestId }),
    cacheName,
    data: type === "delete" ? null : error.message !== "" ? null : (data ?? null),
    hookId,
    httpStatus,
    error,
  });
};

const makeError = (message: string, code?: WorkerErrorCode): WorkerErrorPayload =>
  code !== undefined ? { message, code } : { message };

/**
 * Binary response - transferred via postMessage, not stored in cache.
 * Client receives ArrayBuffer + meta for reconstruction (e.g. new Blob([data], { type })).
 * Always sends a message; empty/zero-length body uses an empty ArrayBuffer so the client does not hang.
 */
const callerResponseBinary = (
  cacheName: string,
  data: ArrayBuffer,
  meta: BinaryResponseMeta,
  hookId?: string | null,
  httpStatus?: number,
  error: WorkerErrorPayload = NO_ERROR,
  requestId?: string | null,
): void => {
  const buffer = data.byteLength ? data : EMPTY_BUFFER;
  const payload = {
    type: "result" as const,
    ...(requestId != null && requestId !== "" && { requestId }),
    cacheName,
    data: buffer,
    meta,
    hookId,
    httpStatus,
    error,
  };
  self.postMessage(payload, buffer.byteLength > 0 ? [buffer] : []);
};

const callerResponseStreamStart = (
  cacheName: string,
  meta: BinaryResponseMeta | null,
  hookId?: string | null,
  httpStatus?: number,
  error: WorkerErrorPayload = NO_ERROR,
  requestId?: string | null,
): void => {
  self.postMessage({
    type: "stream" as const,
    ...(requestId != null && requestId !== "" && { requestId }),
    cacheName,
    stream: "start",
    meta,
    hookId,
    httpStatus,
    error,
  });
};

const callerResponseStreamResume = (
  cacheName: string,
  meta: BinaryResponseMeta | null,
  hookId?: string | null,
  httpStatus?: number,
  error: WorkerErrorPayload = NO_ERROR,
  requestId?: string | null,
): void => {
  self.postMessage({
    type: "stream" as const,
    ...(requestId != null && requestId !== "" && { requestId }),
    cacheName,
    stream: "resume",
    meta,
    hookId,
    httpStatus,
    error,
  });
};

const callerResponseStreamChunk = (
  cacheName: string,
  data: ArrayBuffer,
  hookId?: string | null,
  error: WorkerErrorPayload = NO_ERROR,
  requestId?: string | null,
): void => {
  const buffer = data.byteLength ? data : EMPTY_BUFFER;
  const payload = {
    type: "stream" as const,
    ...(requestId != null && requestId !== "" && { requestId }),
    cacheName,
    stream: "chunk" as const,
    data: buffer,
    hookId,
    error,
  };
  self.postMessage(payload, buffer.byteLength > 0 ? [buffer] : []);
};

const callerResponseStreamEnd = (
  cacheName: string,
  hookId?: string | null,
  error: WorkerErrorPayload = NO_ERROR,
  requestId?: string | null,
): void => {
  self.postMessage({
    type: "stream" as const,
    ...(requestId != null && requestId !== "" && { requestId }),
    cacheName,
    stream: "end",
    hookId,
    error,
  });
};

const transferableBuffer = (view: Uint8Array): ArrayBuffer =>
  view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? (view.buffer as ArrayBuffer)
    : view.slice(0).buffer;

const store = Object.create(null) as Record<string, unknown>;
const storeActivity = new Map<string, number>();
const STALE_ENTRY_MS = 5000;
const CLEANUP_INTERVAL_MS = 30000;

const normalizeKey = (key: string) => key.toLocaleLowerCase();
const touchActivity = (key: string): void => {
  storeActivity.set(normalizeKey(key), Date.now());
};
const get = <TData>(key: string): TData | undefined => {
  const nk = normalizeKey(key);
  touchActivity(nk);
  return store[nk] as TData | undefined;
};
const set = <TData>(key: string, value: TData): void => {
  const nk = normalizeKey(key);
  store[nk] = value;
  touchActivity(nk);
};
const remove = (key: string): void => {
  const nk = normalizeKey(key);
  delete store[nk];
  storeActivity.delete(nk);
};

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Returns headers without Content-Type (either casing). Use when FormData sets it automatically. */
const omitContentType = (headers: Record<string, string>): Record<string, string> => {
  const rest = { ...headers };
  delete rest["Content-Type"];
  delete rest["content-type"];
  return rest;
};

const isBinaryResponse = (r: unknown): r is BinaryParseResult =>
  typeof r === "object" &&
  r !== null &&
  BINARY_MARKER in r &&
  (r as unknown as BinaryParseResult).data instanceof ArrayBuffer;

const commit = <TData>(
  cacheName: string,
  data: TData,
  hookId?: string | null,
  httpStatus?: number,
  requestId?: string | null,
): void => {
  if (!cacheName) {
    callerResponse(
      "",
      null,
      hookId,
      undefined,
      makeError("Invalid commit: cacheName is required", "validation"),
      "result",
      requestId,
    );
    return;
  }
  set(cacheName, data); // set() normalizes internally - avoid double-normalizing here
  touchActivity(cacheName);
  callerResponse(cacheName, data, hookId, httpStatus, NO_ERROR, "result", requestId);
};

/**
 * Parses response based on content-type.
 * Returns parsed data for JSON/text, or binary result with BINARY_MARKER, data (ArrayBuffer), contentType, contentDisposition.
 */
const parseResponseByContentType = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase() || "";
  const contentLength = response.headers.get("content-length");

  // No content
  if (response.status === 204 || contentLength === "0") {
    return null;
  }

  // JSON types - read as text first since chunked responses (no Content-Length) can still be
  // empty; parsing "" directly with response.json() throws even though an empty JSON body is
  // a legitimate, recoverable case rather than a real parse failure.
  if (contentType.includes("json")) {
    const text = await response.text();
    if (text.trim() === "") {
      return null;
    }
    return JSON.parse(text);
  }

  // Text-based types
  if (
    contentType.startsWith("text/") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("x-www-form-urlencoded")
  ) {
    return await response.text();
  }

  // Binary types (known or fallback) - use arrayBuffer for zero-copy transfer to client
  const arrayBuffer = await response.arrayBuffer();
  return {
    [BINARY_MARKER]: true as const,
    data: arrayBuffer,
    contentType,
    contentDisposition: response.headers.get("content-disposition"),
  };
};

/** File/Blob use fileFieldName (default "Files"); all other fields use property name (key). */
const appendToFormData = (
  formData: FormData,
  key: string,
  value: unknown,
  fileFieldName: string = DEFAULT_FILES_FIELD,
  visited?: WeakSet<object>,
): boolean => {
  if (value instanceof File) {
    formData.append(fileFieldName, value, value.name);
    return true;
  }

  if (value instanceof Blob) {
    formData.append(fileFieldName, value, "blob");
    return true;
  }

  if (value !== null && value !== undefined && typeof value === "object") {
    const visitedSet = visited ?? new WeakSet<object>();
    if (visitedSet.has(value)) return false;
    visitedSet.add(value);
    if (Array.isArray(value)) {
      let hasFile = false;
      let i = 0;
      while (i < value.length) {
        hasFile =
          appendToFormData(formData, key ? `${key}.${i}` : String(i), value[i], fileFieldName, visitedSet) || hasFile;
        i++;
      }
      return hasFile;
    }
    let hasFile = false;
    const keys = Object.keys(value);
    let ki = 0;
    while (ki < keys.length) {
      const k = keys[ki] as string;
      hasFile =
        appendToFormData(
          formData,
          key ? `${key}.${k}` : k,
          (value as Record<string, unknown>)[k],
          fileFieldName,
          visitedSet,
        ) || hasFile;

      ki++;
    }
    return hasFile;
  }

  if (value !== undefined && value !== null) {
    const primitive = value as string | number | boolean | bigint;
    formData.append(key, String(primitive));
  }
  return false;
};

const createFormDataIfBlobOrFile = (
  payload: unknown,
  fileFieldName: string = DEFAULT_FILES_FIELD,
  formDataKey: string = DEFAULT_FILES_FIELD,
): FormData | null => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return null;
  }

  const formData = new FormData();
  const visited = new WeakSet<object>();
  const hasFile = appendToFormData(formData, formDataKey, payload, fileFieldName, visited);
  return hasFile ? formData : null;
};

const getContentType = (headers: Record<string, string> = {}): string =>
  headers["Content-Type"] || headers["content-type"] || "application/json";

const getPayloadType = (payload: unknown): string => {
  switch (true) {
    case payload instanceof FormData:
      return "formdata";
    case payload instanceof Blob:
      return "blob";
    case payload instanceof ArrayBuffer:
      return "arraybuffer";
    case ArrayBuffer.isView(payload):
      return "arraybufferview";
    case typeof ReadableStream !== "undefined" && payload instanceof ReadableStream:
      return "stream";
    case typeof payload === "string":
      return "string";
    default:
      return "object";
  }
};

const buildJsonBody = (payload: unknown): BodyInit => JSON.stringify(payload);

/**
 * Builds a URL-encoded body from a flat object. Values must be primitives (string/number/boolean) -
 * nested objects/arrays cannot be represented and throw rather than silently serializing to
 * "[object Object]". null/undefined values are skipped.
 */
const buildUrlEncodedBody = (payload: Record<string, unknown>): BodyInit => {
  const params = new URLSearchParams();
  const keys = Object.keys(payload);
  let i = 0;
  while (i < keys.length) {
    const key = keys[i] as string;
    const value = payload[key];
    if (value !== null && value !== undefined) {
      if (typeof value === "object") {
        throw new Error(`Cannot url-encode non-primitive value for key "${key}"`);
      }
      params.append(key, (value as string | number | boolean | bigint).toString());
    }
    i++;
  }
  return params.toString();
};

const buildTextBody = (payload: unknown): BodyInit => String(payload);

/**
 * Builds body and headers for fetch. Each branch handles one payload type; add new cases here for new body types.
 *
 * Object payloads are always checked for nested File/Blob values first (createFormDataIfBlobOrFile).
 * If any are found, the request is automatically sent as multipart/form-data and any Content-Type
 * header the caller passed in is overwritten/omitted - the browser must set its own Content-Type
 * (including the multipart boundary) for the body to be parsed correctly server-side. Callers no
 * longer need to manually set Content-Type: multipart/form-data to get file uploads to work; it is
 * detected automatically, including files nested arbitrarily deep in the payload (e.g.
 * { photos: File[], videos: File[] }). Every File/Blob found is appended under the same
 * fileFieldName (default "Files", override via formDataFileFieldName) regardless of which property
 * it came from - this matches the common API convention of collecting all uploaded files under one
 * repeated field name. If a caller does pass Content-Type: multipart/form-data but the payload has
 * no actual File/Blob in it, we fall back to JSON and correct the header rather than sending a JSON
 * body mislabeled as multipart.
 */
const prepareRequestBody = (
  payload: unknown,
  headers: Record<string, string>,
  options?: { formDataFileFieldName?: string; formDataKey?: string },
): { body?: BodyInit; headers: Record<string, string> } => {
  const payloadType = getPayloadType(payload);

  switch (payloadType) {
    case "formdata":
      return {
        body: payload as FormData,
        headers: omitContentType({ ...headers }),
      };
    case "blob":
      return { body: payload as Blob, headers: { ...headers } };
    case "arraybuffer":
      return { body: payload as ArrayBuffer, headers: { ...headers } };
    case "arraybufferview":
      return { body: payload as BodyInit, headers: { ...headers } };
    case "stream":
      return {
        body: payload as ReadableStream<Uint8Array>,
        headers: { ...headers },
      };
    case "string":
      return { body: payload as string, headers: { ...headers } };
    case "object": {
      const fileFieldName = options?.formDataFileFieldName ?? DEFAULT_FILES_FIELD;
      const formDataKey = options?.formDataKey ?? DEFAULT_FILES_FIELD;

      // Auto-detect File/Blob anywhere in the payload (including nested, e.g. { photos: File[] }).
      // If found, always send as multipart/form-data - Content-Type is omitted so the browser
      // sets it itself (including the boundary).
      const formData = createFormDataIfBlobOrFile(payload, fileFieldName, formDataKey);
      if (formData) {
        return { body: formData, headers: omitContentType({ ...headers }) };
      }

      const h = { ...headers };
      let contentType = getContentType(h);

      // No File/Blob found: a declared multipart/form-data would produce an invalid body
      // (JSON string labeled as multipart), so fall back to JSON and fix the header.
      if (contentType.includes("multipart/form-data")) {
        contentType = "application/json";
        delete h["Content-Type"];
        delete h["content-type"];
      }

      let body: BodyInit;
      if (contentType.includes("application/x-www-form-urlencoded")) {
        body = buildUrlEncodedBody(payload as Record<string, unknown>);
      } else if (contentType.startsWith("text/") || contentType.includes("xml")) {
        body = buildTextBody(payload);
      } else {
        body = buildJsonBody(payload);
      }

      if (!h["Content-Type"] && !h["content-type"]) {
        h["Content-Type"] = contentType;
      }
      return { body, headers: h };
    }

    default:
      return { headers: { ...headers } };
  }
};

type InFlightEntry = {
  promise: Promise<void>;
  controller: AbortController;
  requestIds: Set<string>;
};
const inFlightByCacheName = new Map<string, InFlightEntry>();
const requestIdToCacheName = new Map<string, string>();

const apiRequest = async <TData>(
  cacheName: string,
  payload: TData | FormData | null,
  {
    url,
    method,
    headers = {},
    mode = "cors",
    credentials = "same-origin",
    responseType,
    timeoutMs,
    formDataFileFieldName,
    formDataKey,
    retries,
  }: WorkerApiRequest,
  requestId?: string | null,
  hookId?: string | null,
): Promise<void> => {
  const methodLower = method.toLocaleLowerCase();
  const responseTypeLower = responseType?.toLocaleLowerCase();

  // Early return (cached then fresh) allowed for any HTTP method, except when response is binary or streaming.
  const skipInFlightDedupe = responseTypeLower === "binary" || responseTypeLower === "stream";
  if (!skipInFlightDedupe) {
    const existing = inFlightByCacheName.get(cacheName);
    if (existing) {
      if (requestId) {
        existing.requestIds.add(requestId);
        requestIdToCacheName.set(requestId, cacheName);
      }
      const cached = get(cacheName);
      if (cached !== undefined) callerResponse(cacheName, cached, hookId, undefined, NO_ERROR, "result", requestId);
      await existing.promise;
      const fresh = get(cacheName);
      if (fresh !== undefined) callerResponse(cacheName, fresh, hookId, undefined, NO_ERROR, "result", requestId);
      return;
    }
  }

  const controller = new AbortController();
  const requestIds = new Set<string>();
  const inflightKey = skipInFlightDedupe && requestId ? requestId : cacheName;
  if (requestId) {
    requestIds.add(requestId);
    requestIdToCacheName.set(requestId, inflightKey);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortedByTimeout = false;
  if (timeoutMs != null && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      abortedByTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  const promise = (async (): Promise<void> => {
    const fetchOptions: RequestInit = {
      method,
      mode,
      credentials,
      signal: controller.signal,
    };

    try {
      if (methodLower !== "get" && payload != null) {
        const prepareOptions: {
          formDataFileFieldName?: string;
          formDataKey?: string;
        } = {};
        if (formDataFileFieldName != null && formDataFileFieldName !== "")
          prepareOptions.formDataFileFieldName = formDataFileFieldName;
        if (formDataKey != null && formDataKey !== "") prepareOptions.formDataKey = formDataKey;
        // Body preparation (JSON.stringify, FormData building, url-encoding) can throw
        // synchronously (e.g. circular references, non-primitive url-encoded values). This must
        // stay inside the try/catch below - a throw here previously rejected this IIFE with no
        // handler, left the caller waiting on a postMessage that never arrives, and skipped the
        // finally block, permanently leaking this cacheName/requestId from the in-flight maps.
        const { body, headers: processedHeaders } = prepareRequestBody(payload, headers, prepareOptions);
        if (body !== undefined) fetchOptions.body = body;
        fetchOptions.headers = processedHeaders;
      } else {
        fetchOptions.headers = omitContentType({ ...headers });
      }

      if (responseTypeLower === "stream") {
        const maxRetries = Math.min(retries ?? 3, 5);
        let bytesReceived = 0;
        let streamError: WorkerErrorPayload = NO_ERROR;
        let attempt = 0;
        let isPermanentError = false;
        while (attempt <= maxRetries) {
          try {
            const reqHeaders =
              methodLower === "get" ? omitContentType({ ...fetchOptions.headers }) : { ...fetchOptions.headers };
            if (bytesReceived > 0) reqHeaders["Range"] = `bytes=${bytesReceived}-`;
            const streamResponse = await fetch(url, {
              ...fetchOptions,
              headers: reqHeaders,
            });
            if (streamResponse.status >= 400) {
              streamError = makeError(streamResponse.statusText || DEFAULT_ERROR, "http");
              isPermanentError = true;
              break;
            }
            if (streamResponse.status === 204) {
              callerResponseStreamEnd(cacheName, hookId, NO_ERROR, requestId);
              return;
            }
            if (streamResponse.status === 416) {
              streamError = makeError("Range Not Satisfiable", "http");
              isPermanentError = true;
              break;
            }
            const contentType = streamResponse.headers.get("content-type") ?? undefined;
            const meta: BinaryResponseMeta = {
              contentDisposition: streamResponse.headers.get("content-disposition") ?? null,
              ...(contentType !== undefined && { contentType }),
            };
            if (bytesReceived === 0)
              callerResponseStreamStart(cacheName, meta, hookId, streamResponse.status, NO_ERROR, requestId);
            else callerResponseStreamResume(cacheName, meta, hookId, streamResponse.status, NO_ERROR, requestId);
            const body = streamResponse.body;
            if (!body) {
              callerResponseStreamEnd(cacheName, hookId, NO_ERROR, requestId);
              return;
            }
            const reader = body.getReader();
            let skipRemaining = streamResponse.status === 200 && bytesReceived > 0 ? bytesReceived : 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value || value.byteLength === 0) continue;
              if (skipRemaining > 0) {
                if (value.byteLength <= skipRemaining) {
                  skipRemaining -= value.byteLength;
                  continue;
                }
                const offset = skipRemaining;
                skipRemaining = 0;
                const tail = value.subarray(offset);
                callerResponseStreamChunk(cacheName, transferableBuffer(tail), hookId, NO_ERROR, requestId);
                bytesReceived += tail.byteLength;
              } else {
                callerResponseStreamChunk(cacheName, transferableBuffer(value), hookId, NO_ERROR, requestId);
                bytesReceived += value.byteLength;
              }
            }
            break;
          } catch (err) {
            if ((err as Error).name === "AbortError") {
              streamError = makeError("Request aborted", abortedByTimeout ? "timeout" : "aborted");
              isPermanentError = true;
              break;
            }
            streamError = makeError((err as Error).message, "network");
            if (attempt === maxRetries) break;
          }
          if (isPermanentError) break;
          attempt++;
        }
        callerResponseStreamEnd(cacheName, hookId, streamError, requestId);
        return;
      }

      const response = await fetch(url, fetchOptions);

      if (response.status >= 400) {
        callerResponse(
          cacheName,
          null,
          hookId,
          response.status,
          makeError(response.statusText || DEFAULT_ERROR, "http"),
          "result",
          requestId,
        );
        return;
      }

      if (response.status === 204) {
        set(cacheName, null); // set() normalizes internally - avoid double-normalizing here
        callerResponse(cacheName, null, hookId, 204, NO_ERROR, "result", requestId);
        return;
      }

      const responseData = await parseResponseByContentType(response);

      if (isBinaryResponse(responseData)) {
        callerResponseBinary(
          cacheName,
          responseData.data,
          {
            contentType: responseData.contentType,
            contentDisposition: responseData.contentDisposition ?? null,
          },
          hookId,
          response.status,
          NO_ERROR,
          requestId,
        );
      } else {
        commit(cacheName, responseData, hookId, response.status, requestId);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        callerResponse(
          cacheName,
          null,
          hookId,
          undefined,
          makeError("Request aborted", abortedByTimeout ? "timeout" : "aborted"),
          "result",
          requestId,
        );
        return;
      }
      const err = error as Error;
      callerResponse(cacheName, null, hookId, undefined, makeError(err.message, "network"), "result", requestId);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      for (const id of requestIds) {
        requestIdToCacheName.delete(id);
      }
      inFlightByCacheName.delete(inflightKey);
    }
  })();

  const entry: InFlightEntry = { promise, controller, requestIds };
  inFlightByCacheName.set(inflightKey, entry);

  await promise;
};

const onRequest = <TData>(dataRequest: DataRequest<TData>): void => {
  const { cacheName, type, payload, request, requestId, hookId } = dataRequest;

  if (!isNonEmptyString(type)) {
    callerResponse(
      cacheName ?? "",
      null,
      hookId,
      undefined,
      makeError("Invalid request: type is required", "validation"),
      "result",
      requestId,
    );
    return;
  }
  const lowerType = normalizeKey(type);

  if (lowerType === "cancel") {
    if (requestId) onCancel(requestId);
    return;
  }

  if (!isNonEmptyString(cacheName)) {
    callerResponse(
      cacheName ?? "",
      null,
      hookId,
      undefined,
      makeError("Invalid request: cacheName is required", "validation"),
      "result",
      requestId,
    );
    return;
  }
  const lowerCacheName = normalizeKey(cacheName);

  if (lowerType === "get") {
    const requestedData = get(lowerCacheName);
    if (requestedData === undefined) {
      callerResponse(
        lowerCacheName,
        null,
        hookId,
        undefined,
        makeError("Cache miss", "validation"),
        "result",
        requestId,
      );
    } else {
      callerResponse(lowerCacheName, requestedData, hookId, undefined, NO_ERROR, "result", requestId);
    }
  } else if (lowerType === "set") {
    if (!request) {
      if (payload == null) {
        callerResponse(
          cacheName ?? "",
          null,
          hookId,
          undefined,
          makeError("Invalid request: payload is required for set", "validation"),
          "result",
          requestId,
        );
        return;
      }
      set(lowerCacheName, payload);
    } else {
      const methodLower = normalizeKey(request.method);
      if (methodLower !== "get" && payload == null) {
        callerResponse(
          cacheName ?? "",
          null,
          hookId,
          undefined,
          makeError("Invalid request: payload is required for non-GET API request", "validation"),
          "result",
          requestId,
        );
        return;
      }
      void apiRequest(lowerCacheName, payload ?? null, request, requestId, hookId);
    }
  } else if (lowerType === "delete") {
    remove(lowerCacheName);
    callerResponse(lowerCacheName, null, hookId, undefined, NO_ERROR, "delete", requestId);
  }
};

const onCancel = (requestId: string): void => {
  const inflightKey = requestIdToCacheName.get(requestId);
  if (!inflightKey) return;

  const entry = inFlightByCacheName.get(inflightKey);
  if (!entry) {
    requestIdToCacheName.delete(requestId);
    return;
  }

  entry.requestIds.delete(requestId);
  requestIdToCacheName.delete(requestId);

  if (entry.requestIds.size === 0) {
    entry.controller.abort();
  }
};

const runStaleStoreCleanup = (): void => {
  const now = Date.now();
  for (const [key, lastAccessAt] of storeActivity) {
    if (now - lastAccessAt < STALE_ENTRY_MS) continue;
    if (inFlightByCacheName.has(key)) continue;
    delete store[key];
    storeActivity.delete(key);
  }
};

setInterval(runStaleStoreCleanup, CLEANUP_INTERVAL_MS);

/**
 * Incoming messages from the main thread. Expects payload shape { dataRequest?: DataRequest }.
 * Responses via postMessage: { cacheName, data?, meta?, hookId?, httpStatus?, error }.
 * error is always present: { message: "" } when no error, { message: "..." } when the request failed.
 */
onmessage = (event: MessageEvent<WorkerMessageData>): void => {
  const payload = event.data;
  if (payload === null || typeof payload !== "object") return;
  const dataRequest = payload.dataRequest;
  if (dataRequest !== undefined) onRequest(dataRequest);
};
