import { Dispatch, SetStateAction } from "react";

export interface RequestConfig {
  url: string;
  method: "GET" | "get" | "POST" | "post" | "PATCH" | "patch" | "DELETE" | "delete";
  mode?: "cors" | "no-cors" | "navigate" | "same-origin";
  body?: unknown;
  headers?: Record<string, string>;
  credentials?: "include" | "same-origin" | "omit";
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

export type WorkerApiRequest = Omit<RequestConfig, "body">;

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

export type BinaryParseResult = {
  __binary: true;
  data: ArrayBuffer;
  contentType: string;
} & Pick<BinaryResponseMeta, "contentDisposition">;

export interface WorkerError {
  message: string;
  code?: string | number;
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
