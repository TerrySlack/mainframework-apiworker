/// <reference lib="webworker" />

import type {
  AbortControllers,
  BinaryParseResult,
  BinaryResponseMeta,
  DataRequest,
  StackArray,
  WorkerApiRequest,
  WorkerErrorKind,
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
 */
const callerResponseBinary = (
  cacheName: string,
  data: ArrayBuffer,
  meta: BinaryResponseMeta,
  hookId?: string | null,
  httpStatus?: number,
): void => {
  if (data) {
    self.postMessage({ cacheName, data, meta, hookId, httpStatus }, [data]);
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

const appendToFormData = (
  formData: FormData,
  key: string,
  value: unknown,
  fileFieldName: string = DEFAULT_FILES_FIELD,
): void => {
  if (value instanceof File) {
    formData.append(fileFieldName, value, value.name);
    return;
  }

  if (value instanceof Blob) {
    formData.append(fileFieldName, value, "blob");
    return;
  }

  if (value !== undefined && value !== null) {
    if (typeof value === "object") {
      formData.append(key, JSON.stringify(value));
    } else {
      const primitive = value as string | number | boolean | bigint | symbol;
      formData.append(key, String(primitive));
    }
  }
};

const pushObjectToStack = (
  obj: Record<string, unknown>,
  parentKey: string,
  stack: Array<{ key: string; value: unknown }>,
) => {
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      stack.push({
        key: parentKey ? `${parentKey}.${k}` : k,
        value: obj[k],
      });
    }
  }
};

const createFormDataIfBlobOrFile = (payload: unknown, fileFieldName: string = DEFAULT_FILES_FIELD): FormData | null => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return null;
  }

  const formData = new FormData();
  let hasFile = false;
  const visited = new WeakSet<object>();
  const stack: StackArray[] = [];

  visited.add(payload);
  if (Array.isArray(payload)) {
    let i = 0;
    while (i < payload.length) {
      stack.push({ key: String(i), value: payload[i] });
      i++;
    }
  } else {
    pushObjectToStack(payload as Record<string, unknown>, "", stack);
  }

  // Safe iteration - iterate forward, then clear
  for (let i = 0; i < stack.length; i++) {
    const entry = stack[i];
    if (entry === undefined) continue;
    const { key, value } = entry;

    if (value instanceof File || value instanceof Blob) {
      hasFile = true;
      appendToFormData(formData, key, value, fileFieldName);
      continue;
    }

    if (Array.isArray(value)) {
      if (visited.has(value)) continue;
      visited.add(value);
      let j = 0;
      while (j < value.length) {
        stack.push({ key: `${key}.${j}`, value: value[j] });
        j++;
      }
      continue;
    }

    if (value !== null && typeof value === "object") {
      if (visited.has(value)) continue;
      visited.add(value);
      pushObjectToStack(value as Record<string, unknown>, key, stack);
      continue;
    }

    appendToFormData(formData, key, value, fileFieldName);
  }

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

const prepareRequestBody = (
  payload: unknown,
  headers: Record<string, string>,
  options?: { formDataFileFieldName?: string },
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
      const h = outHeaders();
      const contentType = getContentType(h);
      const fileFieldName = options?.formDataFileFieldName ?? DEFAULT_FILES_FIELD;

      let body: BodyInit;
      if (contentType.includes("application/json")) {
        body = buildJsonBody(payload);
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        body = buildUrlEncodedBody(payload as Record<string, string>);
      } else if (contentType.startsWith("text/") || contentType.includes("xml")) {
        body = buildTextBody(payload);
      } else if (contentType.includes("multipart/form-data")) {
        const formData = createFormDataIfBlobOrFile(payload, fileFieldName);
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
      const { body, headers: processedHeaders } = prepareRequestBody(
        payload,
        headers,
        formDataFileFieldName != null && formDataFileFieldName !== "" ? { formDataFileFieldName } : undefined,
      );
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

type WorkerMessageData = { dataRequest?: DataRequest<unknown> };

/**
 * Public API: handle incoming messages from the main thread.
 * Expects payload shape { dataRequest?: DataRequest }. Dispatches to get/set/delete/cancel.
 * Responses are sent via postMessage: { cacheName, data?, meta?, hookId?, httpStatus? }.
 * Errors are sent as data: { kind: "http"|"network"|"validation", message, status?, code? }.
 */
export function handleMessage(data: unknown): void {
  if (data === null || typeof data !== "object") return;
  const dataRequest = (data as WorkerMessageData).dataRequest;
  if (dataRequest !== undefined) onRequest(dataRequest);
}

onmessage = (event: MessageEvent): void => {
  handleMessage(event.data);
};
