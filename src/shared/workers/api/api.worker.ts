/// <reference lib="webworker" />

import type {
  AbortControllers,
  BinaryParseResult,
  BinaryResponseMeta,
  DataRequest,
  WorkerApiRequest,
  WorkerErrorPayload,
  WorkerMessageData,
} from "../../types/types";

export const BINARY_MARKER = Symbol.for("WorkerApiBinary");

const DEFAULT_FILES_FIELD = "Files";

const NO_ERROR: WorkerErrorPayload = { message: "" };

const callerResponse = (
  cacheName: string,
  data: unknown,
  hookId?: string | null,
  httpStatus?: number,
  error: WorkerErrorPayload = NO_ERROR,
): void => {
  self.postMessage({
    cacheName,
    data: error.message !== "" ? null : (data ?? null),
    hookId,
    httpStatus,
    error,
  });
};

const makeError = (message: string): WorkerErrorPayload => ({ message });

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
): void => {
  const buffer = data?.byteLength ? data : new ArrayBuffer(0);
  const payload = { cacheName, data: buffer, meta, hookId, httpStatus, error };
  self.postMessage(payload, buffer.byteLength > 0 ? [buffer] : []);
};

const callerResponseStreamStart = (
  cacheName: string,
  meta: BinaryResponseMeta | null,
  hookId?: string | null,
  httpStatus?: number,
  error: WorkerErrorPayload = NO_ERROR,
): void => {
  self.postMessage({ cacheName, stream: "start", meta, hookId, httpStatus, error });
};

const callerResponseStreamResume = (
  cacheName: string,
  meta: BinaryResponseMeta | null,
  hookId?: string | null,
  httpStatus?: number,
  error: WorkerErrorPayload = NO_ERROR,
): void => {
  self.postMessage({ cacheName, stream: "resume", meta, hookId, httpStatus, error });
};

const callerResponseStreamChunk = (
  cacheName: string,
  data: ArrayBuffer,
  hookId?: string | null,
  error: WorkerErrorPayload = NO_ERROR,
): void => {
  const buffer = data?.byteLength ? data : new ArrayBuffer(0);
  const payload = { cacheName, stream: "chunk", data: buffer, hookId, error };
  self.postMessage(payload, buffer.byteLength > 0 ? [buffer] : []);
};

const callerResponseStreamEnd = (
  cacheName: string,
  hookId?: string | null,
  error: WorkerErrorPayload = NO_ERROR,
): void => {
  self.postMessage({ cacheName, stream: "end", hookId, error });
};

const transferableBuffer = (view: Uint8Array): ArrayBuffer =>
  view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? (view.buffer as ArrayBuffer)
    : view.slice(0).buffer;

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
  typeof r === "object" &&
  r !== null &&
  BINARY_MARKER in r &&
  (r as unknown as BinaryParseResult).data instanceof ArrayBuffer;

const commit = <TData>(cacheName: string, data: TData, hookId?: string | null, httpStatus?: number): void => {
  if (!cacheName) {
    callerResponse("", null, hookId, undefined, makeError("Invalid commit: cacheName is required"));
    return;
  }
  set(normalizeKey(cacheName), data);
  callerResponse(cacheName, data, hookId, httpStatus);
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
      let i = 0;
      while (i < value.length) {
        hasFile = appendToFormData(formData, key ? `${key}.${i}` : String(i), value[i], fileFieldName, set) || hasFile;
        i++;
      }
      return hasFile;
    }
    let hasFile = false;
    const keys = Object.keys(value);
    let ki = 0;
    while (ki < keys.length) {
      const k = keys[ki] as string;
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
      ki++;
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

  switch (payloadType) {
    case "formdata":
      return { body: payload as FormData, headers: omitContentType({ ...headers }) };
    case "blob":
      return { body: payload as Blob, headers: { ...headers } };
    case "arraybuffer":
      return { body: payload as ArrayBuffer, headers: { ...headers } };
    case "arraybufferview":
      return { body: payload as BodyInit, headers: { ...headers } };
    case "stream":
      return { body: payload as ReadableStream<Uint8Array>, headers: { ...headers } };
    case "string":
      return { body: payload as string, headers: { ...headers } };
    case "object": {
      const h = { ...headers };
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
      return { headers: { ...headers } };
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
      const prepareOptions: { formDataFileFieldName?: string; formDataKey?: string } = {};
      if (formDataFileFieldName != null && formDataFileFieldName !== "")
        prepareOptions.formDataFileFieldName = formDataFileFieldName;
      if (formDataKey != null && formDataKey !== "") prepareOptions.formDataKey = formDataKey;
      const { body, headers: processedHeaders } = prepareRequestBody(payload, headers, prepareOptions);
      if (body !== undefined) fetchOptions.body = body;
      fetchOptions.headers = processedHeaders;
    } else {
      fetchOptions.headers = omitContentType({ ...headers });
    }

    try {
      if (responseTypeLower === "stream") {
        const maxRetries = Math.min(retries ?? 3, 5);
        let bytesReceived = 0;
        let streamError: WorkerErrorPayload = NO_ERROR;
        let attempt = 0;
        while (attempt <= maxRetries) {
          try {
            const reqHeaders =
              methodLower === "get" ? omitContentType({ ...fetchOptions.headers }) : fetchOptions.headers;
            if (bytesReceived > 0) reqHeaders["Range"] = `bytes=${bytesReceived}-`;
            const streamResponse = await fetch(url, { ...fetchOptions, headers: reqHeaders });
            if (streamResponse.status >= 400) {
              streamError = makeError(streamResponse.statusText);
              break;
            }
            if (streamResponse.status === 204) {
              callerResponseStreamEnd(cacheName, hookId);
              return;
            }
            if (streamResponse.status === 416) break;
            const contentType = streamResponse.headers.get("content-type") ?? undefined;
            const meta: BinaryResponseMeta = {
              contentDisposition: streamResponse.headers.get("content-disposition") ?? null,
              ...(contentType !== undefined && { contentType }),
            };
            if (bytesReceived === 0) callerResponseStreamStart(cacheName, meta, hookId, streamResponse.status);
            else callerResponseStreamResume(cacheName, meta, hookId, streamResponse.status);
            const body = streamResponse.body;
            if (!body) {
              callerResponseStreamEnd(cacheName, hookId);
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
                callerResponseStreamChunk(cacheName, transferableBuffer(tail), hookId);
                bytesReceived += tail.byteLength;
              } else {
                callerResponseStreamChunk(cacheName, transferableBuffer(value), hookId);
                bytesReceived += value.byteLength;
              }
            }
            break;
          } catch (err) {
            streamError =
              (err as Error).name === "AbortError" ? makeError("Request aborted") : makeError((err as Error).message);
            if (attempt === maxRetries) break;
          }
          attempt++;
        }
        callerResponseStreamEnd(cacheName, hookId, streamError);
        return;
      }

      const response = await fetch(url, fetchOptions);

      if (response.status >= 400) {
        callerResponse(cacheName, null, hookId, response.status, makeError(response.statusText));
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
        callerResponse(cacheName, null, hookId, undefined, makeError("Request aborted"));
        return;
      }
      const err = error as Error;
      callerResponse(cacheName, null, hookId, undefined, makeError(err.message));
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
  const responseCacheName = dataRequest.cacheName ?? "";

  if (!isNonEmptyString(type)) {
    callerResponse(responseCacheName, null, hookId, undefined, makeError("Invalid request: type is required"));
    return;
  }
  const lowerType = normalizeKey(type);

  if (lowerType === "cancel") {
    if (requestId) onCancel(requestId);
    return;
  }

  if (!isNonEmptyString(cacheName)) {
    callerResponse(responseCacheName, null, hookId, undefined, makeError("Invalid request: cacheName is required"));
    return;
  }
  const lowerCacheName = normalizeKey(cacheName);

  if (lowerType === "get") {
    const requestedData = get(lowerCacheName);
    if (requestedData === undefined) {
      callerResponse(lowerCacheName, null, hookId, undefined, makeError("Cache miss"));
    } else {
      callerResponse(lowerCacheName, requestedData, hookId);
    }
  } else if (lowerType === "set") {
    if (!request) {
      if (payload == null) {
        callerResponse(
          responseCacheName,
          null,
          hookId,
          undefined,
          makeError("Invalid request: payload is required for set"),
        );
        return;
      }
      set(lowerCacheName, payload);
    } else {
      const methodLower = normalizeKey(request.method);
      if (methodLower !== "get" && payload == null) {
        callerResponse(
          responseCacheName,
          null,
          hookId,
          undefined,
          makeError("Invalid request: payload is required for non-GET API request"),
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
 * Responses via postMessage: { cacheName, data?, meta?, hookId?, httpStatus?, error }.
 * error is always present: { message: "" } when no error, { message: "..." } when the request failed.
 */
onmessage = (event: MessageEvent<WorkerMessageData>): void => {
  const payload = event.data;
  if (payload === null || typeof payload !== "object") return;
  const dataRequest = payload.dataRequest;
  if (dataRequest !== undefined) onRequest(dataRequest);
};
