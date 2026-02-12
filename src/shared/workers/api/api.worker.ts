/// <reference lib="webworker" />

import type {
  AbortControllers,
  BinaryParseResult,
  BinaryResponseMeta,
  DataRequest,
  WorkerApiRequest,
  WorkerErrorKind,
  WorkerMessageData,
} from "../../types/types";

export const BINARY_MARKER = Symbol.for("WorkerApiBinary");

const CODE_CACHE_MISS = "CACHE_MISS";
const CODE_INVALID_REQUEST = "INVALID_REQUEST";
const CODE_NETWORK_ERROR = "NETWORK_ERROR";
const CODE_UNKNOWN = "UNKNOWN";
const DEFAULT_FILES_FIELD = "Files";

const callerResponse = <T>(cacheName: string, data: T, hookId?: string | null, httpStatus?: number): void => {
  self.postMessage({ cacheName, data: data ?? null, hookId, httpStatus });
};

const makeError = (
  kind: WorkerErrorKind,
  message: string,
  opts?: { status?: number; code?: string },
): { kind: WorkerErrorKind; message: string; status?: number; code?: string } => ({
  kind,
  message,
  ...opts,
});

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
): void => {
  const buffer = data && data.byteLength > 0 ? data : new ArrayBuffer(0);
  if (buffer === data) {
    self.postMessage({ cacheName, data: buffer, meta, hookId, httpStatus }, [buffer]);
  } else {
    self.postMessage({ cacheName, data: buffer, meta, hookId, httpStatus });
  }
};

const store = Object.create(null) as Record<string, unknown>;
const normalizeKey = (key: string) => key.toLocaleLowerCase();
const get = <TData>(key: string): TData | undefined => store[normalizeKey(key)] as TData | undefined;
const set = <TData>(key: string, value: TData): void => {
  store[normalizeKey(key)] = value;
};
const remove = (key: string): void => {
  delete store[normalizeKey(key)];
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
  !!r &&
  typeof r === "object" &&
  BINARY_MARKER in r &&
  (r as Record<symbol, unknown>)[BINARY_MARKER] === true &&
  (r as unknown as BinaryParseResult).data instanceof ArrayBuffer;

const commit = <TData>(cacheName: string, data: TData, hookId?: string | null, httpStatus?: number): void => {
  if (cacheName) {
    set(normalizeKey(cacheName), data);
    callerResponse(cacheName, data, hookId, httpStatus);
    return;
  }

  callerResponse(
    "error",
    makeError("validation", "Invalid commit: cacheName is required", { code: CODE_INVALID_REQUEST }),
    hookId,
  );
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

  // JSON types - let it throw if malformed
  if (contentType.includes("json")) {
    return await response.json();
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
    const set = visited ?? new WeakSet<object>();
    if (set.has(value)) return false;
    set.add(value);
    if (Array.isArray(value)) {
      let hasFile = false;
      for (let i = 0; i < value.length; i++) {
        hasFile = appendToFormData(formData, key ? `${key}.${i}` : String(i), value[i], fileFieldName, set) || hasFile;
      }
      return hasFile;
    }
    let hasFile = false;
    for (const k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        hasFile =
          appendToFormData(
            formData,
            key ? `${key}.${k}` : k,
            (value as Record<string, unknown>)[k],
            fileFieldName,
            set,
          ) || hasFile;
      }
    }
    return hasFile;
  }

  if (value !== undefined && value !== null) {
    const primitive = value as string | number | boolean | bigint | symbol;
    formData.append(key, primitive as string | Blob);
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
const buildUrlEncodedBody = (payload: Record<string, string>): BodyInit => new URLSearchParams(payload).toString();
const buildTextBody = (payload: unknown): BodyInit => String(payload);

/**
 * Builds body and headers for fetch. Each branch handles one payload type; add new cases here for new body types.
 */
const prepareRequestBody = (
  payload: unknown,
  headers: Record<string, string>,
  options?: { formDataFileFieldName?: string; formDataKey?: string },
): { body?: BodyInit; headers: Record<string, string> } => {
  const payloadType = getPayloadType(payload);
  const outHeaders = (): Record<string, string> => ({ ...headers });

  switch (payloadType) {
    case "formdata":
      return { body: payload as FormData, headers: omitContentType(outHeaders()) };
    case "blob":
      return { body: payload as Blob, headers: outHeaders() };
    case "arraybuffer":
      return { body: payload as ArrayBuffer, headers: outHeaders() };
    case "arraybufferview":
      return { body: payload as BodyInit, headers: outHeaders() };
    case "stream":
      return { body: payload as ReadableStream<Uint8Array>, headers: outHeaders() };
    case "string":
      return { body: payload as string, headers: outHeaders() };
    case "object": {
      /* Serialize by Content-Type: json, urlencoded, text, or multipart (with File/Blob). */
      const h = outHeaders();
      const contentType = getContentType(h);
      const fileFieldName = options?.formDataFileFieldName ?? DEFAULT_FILES_FIELD;
      const formDataKey = options?.formDataKey ?? DEFAULT_FILES_FIELD;

      let body: BodyInit;
      if (contentType.includes("application/json")) {
        body = buildJsonBody(payload);
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        body = buildUrlEncodedBody(payload as Record<string, string>);
      } else if (contentType.startsWith("text/") || contentType.includes("xml")) {
        body = buildTextBody(payload);
      } else if (contentType.includes("multipart/form-data")) {
        const formData = createFormDataIfBlobOrFile(payload, fileFieldName, formDataKey);
        if (formData) {
          return { body: formData, headers: omitContentType(h) };
        }
        body = buildJsonBody(payload);
        h["Content-Type"] = "application/json";
      } else {
        body = buildJsonBody(payload);
      }

      if (!h["Content-Type"] && !h["content-type"]) {
        h["Content-Type"] = contentType;
      }
      return { body, headers: h };
    }

    default:
      return { headers: outHeaders() };
  }
};

const inFlightControllers: AbortControllers = new Map();
const inFlightByCacheName = new Map<string, Promise<void>>();

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
      const cached = get(cacheName);
      if (cached !== undefined) callerResponse(cacheName, cached, hookId);
      await existing;
      const fresh = get(cacheName);
      if (fresh !== undefined) callerResponse(cacheName, fresh, hookId);
      return;
    }
  }

  const controller = new AbortController();
  if (requestId) {
    inFlightControllers.set(requestId, controller);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs != null && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  const promise = (async (): Promise<void> => {
    const fetchOptions: RequestInit = {
      method,
      mode,
      credentials,
      signal: controller.signal,
    };

    if (methodLower !== "get" && payload != null) {
      let prepareOptions: { formDataFileFieldName?: string; formDataKey?: string } | undefined;
      if (formDataFileFieldName != null && formDataFileFieldName !== "") {
        prepareOptions = { formDataFileFieldName };
      }
      if (formDataKey != null && formDataKey !== "") {
        prepareOptions = { ...prepareOptions, formDataKey };
      }
      const { body, headers: processedHeaders } = prepareRequestBody(payload, headers, prepareOptions);
      if (body !== undefined) fetchOptions.body = body;
      fetchOptions.headers = processedHeaders;
    } else {
      fetchOptions.headers = omitContentType({ ...headers });
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (response.status >= 400) {
        callerResponse(
          cacheName,
          makeError("http", response.statusText, { status: response.status, code: String(response.status) }),
          hookId,
          response.status,
        );
        return;
      }

      if (response.status === 204) {
        set(normalizeKey(cacheName), null);
        callerResponse(cacheName, null, hookId, 204);
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
        );
      } else {
        commit(cacheName, responseData, hookId, response.status);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        callerResponse(cacheName, makeError("aborted", "Request aborted"), hookId);
        return;
      }
      const err = error as Error;
      const code = err.name === "TypeError" ? CODE_NETWORK_ERROR : CODE_UNKNOWN;
      callerResponse(cacheName, makeError("network", err.message, { code }), hookId);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      if (requestId) {
        inFlightControllers.delete(requestId);
      }
      inFlightByCacheName.delete(cacheName);
    }
  })();

  inFlightByCacheName.set(cacheName, promise);
  await promise;
};

const onRequest = <TData>(dataRequest: DataRequest<TData>): void => {
  const { cacheName, type, payload, request, requestId, hookId } = dataRequest;

  if (!isNonEmptyString(type)) {
    callerResponse(
      "error",
      makeError("validation", "Invalid request: type is required", { code: CODE_INVALID_REQUEST }),
      hookId,
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
      "error",
      makeError("validation", "Invalid request: cacheName is required", { code: CODE_INVALID_REQUEST }),
      hookId,
    );
    return;
  }
  const lowerCacheName = normalizeKey(cacheName);

  if (lowerType === "get") {
    const requestedData = get(lowerCacheName);
    if (requestedData === undefined) {
      callerResponse(lowerCacheName, makeError("validation", "Cache miss", { code: CODE_CACHE_MISS }), hookId);
    } else {
      callerResponse(lowerCacheName, requestedData, hookId);
    }
  } else if (lowerType === "set") {
    if (!request) {
      if (payload == null) {
        callerResponse(
          "error",
          makeError("validation", "Invalid request: payload is required for set", { code: CODE_INVALID_REQUEST }),
          hookId,
        );
        return;
      }
      set(lowerCacheName, payload);
    } else {
      const methodLower = normalizeKey(request.method);
      if (methodLower !== "get" && payload == null) {
        callerResponse(
          "error",
          makeError("validation", "Invalid request: payload is required for non-GET API request", {
            code: CODE_INVALID_REQUEST,
          }),
          hookId,
        );
        return;
      }
      void apiRequest(lowerCacheName, payload ?? null, request, requestId, hookId);
    }
  } else if (lowerType === "delete") {
    remove(lowerCacheName);
    callerResponse(lowerCacheName, { deleted: true }, hookId);
  }
};

const onCancel = (requestId: string): void => {
  const controller = inFlightControllers.get(requestId);
  if (controller) {
    controller.abort();
    inFlightControllers.delete(requestId);
  }
};

/**
 * Incoming messages from the main thread. Expects payload shape { dataRequest?: DataRequest }.
 * Dispatches to get/set/delete/cancel. Responses via postMessage: { cacheName, data?, meta?, hookId?, httpStatus? }.
 * Errors are sent as data (WorkerError), not a separate error property: { kind, message, status?, code? }.
 */
onmessage = (event: MessageEvent<WorkerMessageData>): void => {
  const payload = event.data;
  if (payload === null || typeof payload !== "object") return;
  const dataRequest = payload.dataRequest;
  if (dataRequest !== undefined) onRequest(dataRequest);
};
