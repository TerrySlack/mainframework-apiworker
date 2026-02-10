/// <reference lib="webworker" />

import type {
  AbortControllers,
  BinaryParseResult,
  BinaryResponseMeta,
  DataRequest,
  StackArray,
  WorkerApiRequest,
} from "../../types/types";

const callerResponse = <T>(cacheName: string, data: T, hookId?: string | null, httpStatus?: number): void => {
  if ((data !== undefined && data !== null) || httpStatus !== undefined) {
    self.postMessage({ cacheName, data: data ?? null, hookId, httpStatus });
  }
};

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

/** Returns headers without Content-Type (either casing). Use when FormData sets it automatically. */
const omitContentType = (headers: Record<string, string>): Record<string, string> => {
  const rest = { ...headers };
  delete rest["Content-Type"];
  delete rest["content-type"];
  return rest;
};

const isBinaryResponse = (r: unknown): r is BinaryParseResult =>
  !!r && typeof r === "object" && "__binary" in r && (r as { __binary: unknown }).__binary === true;

const commit = <TData>(cacheName: string, data: TData, hookId?: string | null, httpStatus?: number): void => {
  if (cacheName) {
    set(normalizeKey(cacheName), data);
    callerResponse(cacheName, data, hookId, httpStatus);
    return;
  }

  callerResponse("error", { error: "Invalid commit: cacheName is required", code: "INVALID_REQUEST" }, hookId);
};

/**
 * Parses response based on content-type.
 * Returns parsed data for JSON/text, or { __binary, data, contentType, contentDisposition } for binary.
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
    __binary: true as const,
    data: arrayBuffer,
    contentType,
    contentDisposition: response.headers.get("content-disposition"),
  };
};

// Top-level helper
const appendToFormData = (formData: FormData, key: string, value: unknown): void => {
  if (value instanceof File) {
    formData.append("Files", value, value.name);
    return;
  }

  if (value instanceof Blob) {
    formData.append("Files", value, "blob");
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

const createFormDataIfBlobOrFile = (payload: unknown): FormData | null => {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return null;
  }

  const formData = new FormData();
  let hasFile = false;

  const stack: StackArray[] = [];

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
      appendToFormData(formData, key, value);
      continue;
    }

    if (Array.isArray(value)) {
      let j = 0;
      while (j < value.length) {
        stack.push({ key: `${key}.${j}`, value: value[j] });
        j++;
      }
      continue;
    }

    if (value !== null && typeof value === "object") {
      pushObjectToStack(value as Record<string, unknown>, key, stack);
      continue;
    }

    appendToFormData(formData, key, value);
  }

  return hasFile ? formData : null;
};
//Extracts Content-Type from headers object Returns "application/json" if not found
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
    case payload instanceof ReadableStream:
      return "stream";
    case typeof payload === "string":
      return "string";
    default:
      return "object";
  }
};

const prepareRequestBody = (
  payload: unknown,
  headers: Record<string, string>,
): { body?: BodyInit; headers: Record<string, string> } => {
  const payloadType = getPayloadType(payload);

  switch (payloadType) {
    case "formdata":
      return {
        body: payload as FormData,
        headers: omitContentType(headers),
      };

    case "blob":
      return {
        body: payload as Blob,
        headers,
      };

    case "arraybuffer":
      return {
        body: payload as ArrayBuffer,
        headers,
      };

    case "arraybufferview":
      return {
        body: payload as BodyInit,
        headers,
      };

    case "stream":
      return {
        body: payload as ReadableStream<Uint8Array>,
        headers,
      };

    case "string":
      return {
        body: payload as string,
        headers,
      };

    case "object": {
      const contentType = getContentType(headers);
      let body: BodyInit;
      let finalHeaders = headers;

      if (contentType.includes("application/json")) {
        body = JSON.stringify(payload);
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        body = new URLSearchParams(payload as Record<string, string>).toString();
      } else if (contentType.startsWith("text/") || contentType.includes("xml")) {
        body = String(payload);
      } else if (contentType.includes("multipart/form-data")) {
        const formData = createFormDataIfBlobOrFile(payload);
        if (formData) {
          body = formData;
          finalHeaders = omitContentType(headers);
        } else {
          body = JSON.stringify(payload);
          finalHeaders = {
            ...headers,
            "Content-Type": "application/json",
          };
        }
      } else {
        body = JSON.stringify(payload);
      }

      if (!finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
        finalHeaders = {
          ...headers,
          "Content-Type": contentType,
        };
      }

      return { body, headers: finalHeaders };
    }

    default:
      return { headers };
  }
};

const inFlightControllers: AbortControllers = new Map();
const inFlightByCacheName = new Map<string, Promise<void>>();

const apiRequest = async <TData>(
  cacheName: string,
  payload: TData | FormData | null,
  { url, method, headers = {}, mode = "cors", credentials = "include" }: WorkerApiRequest,
  requestId?: string | null,
  hookId?: string | null,
): Promise<void> => {
  const existing = inFlightByCacheName.get(cacheName);
  if (existing) {
    await existing;
    const cached = get(cacheName);
    if (cached !== undefined) callerResponse(cacheName, cached, hookId);
    return;
  }

  const controller = new AbortController();
  if (requestId) {
    inFlightControllers.set(requestId, controller);
  }

  const promise = (async (): Promise<void> => {
    const fetchOptions: RequestInit = {
      method,
      mode,
      credentials,
      signal: controller.signal,
    };

    if (method.toUpperCase() !== "GET" && payload != null) {
      const { body, headers: processedHeaders } = prepareRequestBody(payload, headers);
      if (body !== undefined) fetchOptions.body = body;
      fetchOptions.headers = processedHeaders;
    } else {
      fetchOptions.headers = omitContentType(headers);
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        callerResponse(cacheName, { error: response.statusText, code: response.status }, hookId, response.status);
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
      const code = err.name === "TypeError" ? "NETWORK_ERROR" : "UNKNOWN";
      callerResponse(cacheName, { error: err.message, code }, hookId);
    } finally {
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
  if (!dataRequest?.type) {
    callerResponse(
      "error",
      { error: "Invalid request: type is required", code: "INVALID_REQUEST" },
      dataRequest?.hookId,
    );
    return;
  }
  const { cacheName, type, payload, request, requestId, hookId } = dataRequest;
  const lowerType = normalizeKey(type);

  if (lowerType === "cancel") {
    if (requestId) onCancel(requestId);
    return;
  }

  if (!cacheName) {
    callerResponse("error", { error: "Invalid request: cacheName is required", code: "INVALID_REQUEST" }, hookId);
    return;
  }
  const lowerCacheName = normalizeKey(cacheName);

  if (lowerType === "get") {
    const requestedData = get(lowerCacheName);
    if (requestedData === undefined) {
      callerResponse(lowerCacheName, { error: "Cache miss", code: "CACHE_MISS" }, hookId);
    } else {
      callerResponse(lowerCacheName, requestedData, hookId);
    }
  } else if (lowerType === "set") {
    if (!request) {
      set(lowerCacheName, payload);
    } else {
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

onmessage = (event: MessageEvent): void => {
  const data = event.data as unknown;
  if (data === null || typeof data !== "object") return;
  const dataRequest = (data as WorkerMessageData).dataRequest;
  if (dataRequest !== undefined) onRequest(dataRequest);
};
