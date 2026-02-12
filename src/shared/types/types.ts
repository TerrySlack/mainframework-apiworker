import type { Dispatch, SetStateAction } from "react";

/** When "binary" or "stream", in-flight dedupe is skipped so we always run the request and return real response (no stale). */
export type ResponseType = "json" | "binary" | "stream";

export interface RequestConfig {
  url: string;
  method: "GET" | "get" | "POST" | "post" | "PATCH" | "patch" | "DELETE" | "delete";
  mode?: "cors" | "no-cors" | "navigate" | "same-origin";
  headers?: Record<string, string>;
  credentials?: "include" | "same-origin" | "omit";
  /** Omit or "json": allow in-flight dedupe. "binary" or "stream": no early return, always process request. */
  responseType?: ResponseType;
  /** Abort request after this many milliseconds. */
  timeoutMs?: number;
  /** FormData field name for File/Blob parts. Default "Files". */
  formDataFileFieldName?: string;
  /** FormData key for the root payload when building multipart form data. Passed to the worker in dataRequest.request. */
  formDataKey?: string;
}

export type RunMode = "auto" | "manual" | "once";

export interface UseApiWorkerConfig {
  cacheName: string;
  request?: RequestConfig;
  data?: unknown;
  runMode?: RunMode;
  enabled?: boolean;
}

export type WorkerDataRequestType = "get" | "set" | "delete" | "cancel";

export type WorkerApiRequest = RequestConfig;

export interface DataRequest<T = unknown> {
  hookId?: string;
  cacheName?: string;
  type: WorkerDataRequestType;
  payload?: T;
  request?: WorkerApiRequest;
  /** Required for cancel, optional for set (enables cancellation). */
  requestId?: string | null;
}

export interface BinaryResponseMeta {
  contentType?: string;
  contentDisposition: string | null;
}

/** Type-only: binary parse results use Symbol.for("WorkerApiBinary"). Value lives in api.worker. */
declare const BINARY_MARKER: unique symbol;

export type BinaryParseResult = {
  [BINARY_MARKER]: true;
  data: ArrayBuffer;
  contentType: string;
} & Pick<BinaryResponseMeta, "contentDisposition">;

export type WorkerErrorKind = "http" | "network" | "validation" | "aborted";

export interface WorkerError {
  kind: WorkerErrorKind;
  message: string;
  status?: number;
  code?: string;
}

export interface QueueEntry<T> {
  hookId: string;
  cacheName: string;
  loading: boolean | null;
  data: T | null;
  meta: BinaryResponseMeta | null;
  error: WorkerError | null;
  setUpdateTrigger: Dispatch<SetStateAction<number>> | null;
  requestId: string | null;
  lastActivityAt: number | null;
}

export interface UseApiWorkerReturn<T> {
  data: T | null;
  meta: BinaryResponseMeta | null;
  loading: boolean;
  error: WorkerError | null;
  refetch: () => void;
  deleteCache: () => void;
}

export type AbortControllers = Map<string, AbortController>;

/**
 * Worker response messages. Use in client onmessage handler:
 * - data + meta: binary response (data is ArrayBuffer). Reconstruct: new Blob([data], { type: meta?.contentType })
 * - data only: JSON/text response
 * - error: error response with message and code
 */
export type WorkerResponseMessage =
  | { cacheName: string; data: unknown }
  | { cacheName: string; data: ArrayBuffer; meta: BinaryResponseMeta }
  | { cacheName: string; error: WorkerError };

/**
 * Payload shape for worker postMessage. Use for client onmessage:
 * MessageEvent<WorkerMessagePayload>. Success: data = body.
 * Errors are sent as data (WorkerError), not as a separate error property: data = WorkerError (kind, message, status?, code?).
 */
export interface WorkerMessagePayload {
  cacheName?: string;
  /** Response body or error payload (WorkerError when kind is "http"|"network"|"validation"|"aborted"). */
  data?: unknown;
  meta?: BinaryResponseMeta;
  error?: WorkerError;
  hookId?: string;
  httpStatus?: number;
}

export interface StackArray {
  key: string;
  value: unknown;
}

//Use this in the hook to show the engineer what kind of content type to use
export type ContentType =
  // Application types
  | "application/json"
  | "application/xml"
  | "application/x-www-form-urlencoded"
  | "application/pdf"
  | "application/zip"
  | "application/gzip"
  | "application/octet-stream"
  | "application/javascript"
  | "application/ld+json"
  | "application/vnd.api+json"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  // Text types
  | "text/plain"
  | "text/html"
  | "text/css"
  | "text/csv"
  | "text/javascript"
  | "text/xml"
  // Image types
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/svg+xml"
  | "image/webp"
  | "image/bmp"
  | "image/tiff"
  | "image/x-icon"
  | "image/avif"
  // Audio types
  | "audio/mpeg"
  | "audio/ogg"
  | "audio/wav"
  | "audio/webm"
  | "audio/aac"
  | "audio/midi"
  // Video types
  | "video/mp4"
  | "video/mpeg"
  | "video/webm"
  | "video/ogg"
  | "video/quicktime"
  | "video/x-msvideo"
  // Multipart types
  | "multipart/form-data"
  | "multipart/mixed"
  | "multipart/alternative"
  // Font types
  | "font/woff"
  | "font/woff2"
  | "font/ttf"
  | "font/otf";

export type WorkerMessageData = { dataRequest?: DataRequest<unknown> };
