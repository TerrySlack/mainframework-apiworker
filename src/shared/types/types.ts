/**
 * When "binary" or "stream", in-flight dedupe is skipped so we always run the request and return real response (no stale).
 * Note: does not affect response parsing — Content-Type always governs the parse path.
 */
export type ResponseType = "json" | "binary" | "stream";

export interface RequestConfig {
  url: string;
  method: "GET" | "get" | "POST" | "post" | "PATCH" | "patch" | "DELETE" | "delete";
  mode?: "cors" | "no-cors" | "navigate" | "same-origin";
  headers?: Record<string, string>;
  credentials?: "include" | "same-origin" | "omit";
  /** Omit or "json": allow in-flight dedupe. "binary" or "stream": no early return, always process request. Does not affect response parsing — Content-Type always governs the parse path. */
  responseType?: ResponseType;
  /** Abort request after this many milliseconds. */
  timeoutMs?: number;
  /** FormData field name for File/Blob parts. Default "Files". */
  formDataFileFieldName?: string;
  /** FormData key for the root payload when building multipart form data. Passed to the worker in dataRequest.request. */
  formDataKey?: string;
  /** For responseType "stream": number of retries on connection loss (default 3). Capped at 5 in the worker. */
  retries?: number;
  /** For responseType "stream": flush batch to consumer every N chunks (default 5). */
  streamChunkBatchSize?: number;
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

/** Worker always sends this shape; no error = { message: "" }. */
export interface WorkerErrorPayload {
  message: string;
}

export interface QueueEntry<T> {
  hookId: string;
  cacheName: string;
  loading: boolean | null;
  data: T | null;
  meta: BinaryResponseMeta | null;
  error: string | null;
  setUpdateTriggers: Set<(value: number | ((prev: number) => number)) => void>;
  requestId: string | null;
  lastActivityAt: number | null;
  /** For responseType "stream": batch of chunks since last flush. Absent for non-stream. */
  streamChunks?: ArrayBuffer[] | undefined;
  /** Internal: throttle param set when stream request starts. */
  streamChunkBatchSize?: number;
}

export interface UseApiWorkerReturn<T> {
  data: T | null;
  meta: BinaryResponseMeta | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  deleteCache: () => void;
  /** For responseType "stream": batch of chunks since last flush. Undefined for non-stream. */
  streamChunks?: ArrayBuffer[] | undefined;
}

export type AbortControllers = Map<string, AbortController>;

/** @deprecated Use WorkerMessagePayload. */
export type WorkerResponseMessage = WorkerMessagePayload;

/**
 * Payload shape for worker postMessage. Use for client onmessage:
 * MessageEvent<WorkerMessagePayload>. The worker always sends error (same shape: { message: string }).
 * No error = { message: "" }. With error = { message: "..." }.
 * When stream is present, client receives start → chunk(s) → end; cancel via existing requestId/cancel.
 */
export type WorkerMessagePayload =
  | {
      cacheName?: string;
      data?: unknown;
      meta?: BinaryResponseMeta;
      error: WorkerErrorPayload;
      hookId?: string;
      httpStatus?: number;
    }
  | {
      cacheName: string;
      stream: "start";
      meta: BinaryResponseMeta | null;
      hookId?: string;
      httpStatus?: number;
      error: WorkerErrorPayload;
    }
  | {
      cacheName: string;
      stream: "resume";
      meta: BinaryResponseMeta | null;
      hookId?: string;
      httpStatus?: number;
      error: WorkerErrorPayload;
    }
  | { cacheName: string; stream: "chunk"; data: ArrayBuffer; hookId?: string; error: WorkerErrorPayload }
  | { cacheName: string; stream: "end"; hookId?: string; error: WorkerErrorPayload };

export type WorkerMessageData = { dataRequest?: DataRequest<unknown> };
