// useApiWorker.ts
import { useRef, useState, useCallback } from "react";
import { createApiWorker } from "../utils/createApiWorker";
import { uniqueId } from "../utils/uniqueId";
import type {
  BinaryResponseMeta,
  DataRequest,
  QueueEntry,
  UseApiWorkerConfig,
  UseApiWorkerReturn,
  WorkerMessagePayload,
} from "../types/types";

type StreamAccumulator = { chunks: ArrayBuffer[]; meta: BinaryResponseMeta | null };

type StreamThrottleState = {
  pendingChunks: ArrayBuffer[];
};

const DEFAULT_CHUNK_BATCH = 5;

const toNumber = (val: unknown, fallback: number): number =>
  typeof val === "number" && Number.isFinite(val) ? val : fallback;

const toStreamChunks = (val: unknown): ArrayBuffer[] | undefined =>
  val === undefined || val === null ? undefined : Array.isArray(val) ? (val as ArrayBuffer[]) : undefined;

import { useCustomCallback } from "./useCustomCallback";

// ============================================================================
// MODULE-LEVEL WORKER & QUEUE
// ============================================================================

let apiWorker: Worker | null = null;
let workerInitialized = false;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

const STALE_ENTRY_MS = 5000;
const CLEANUP_INTERVAL_MS = 30000;

const normalizeKey = (key: string) => key.toLocaleLowerCase();

const cleanupState = { isDeleting: false, lastRun: 0 };

const runStaleEntryCleanup = (): void => {
  const now = Date.now();
  if (cleanupState.isDeleting || now < cleanupState.lastRun + CLEANUP_INTERVAL_MS) return;

  cleanupState.isDeleting = true;

  try {
    const keys = Object.keys(responseQueue);
    let i = 0;
    while (i < keys.length) {
      const key = keys[i] as string;
      const entry = responseQueue[key];
      const streamInProgress = streamThrottleState[key] != null || streamAccumulators[key] != null;
      if (
        entry &&
        !streamInProgress &&
        entry.data != null &&
        entry.lastActivityAt != null &&
        now - entry.lastActivityAt >= STALE_ENTRY_MS
      ) {
        entry.loading = null;
        entry.data = null;
        entry.meta = null;
        entry.error = null;
        entry.setUpdateTrigger = null;
        entry.requestId = null;
        delete entry.streamChunks;
        delete streamThrottleState[key];
      }
      i++;
    }
  } finally {
    cleanupState.isDeleting = false;
    cleanupState.lastRun = now;
  }
};

const responseQueue: Record<string, QueueEntry<unknown>> = {};

const streamAccumulators: Record<string, StreamAccumulator> = {};
const streamThrottleState: Record<string, StreamThrottleState> = {};

const updater = (n: number) => n + 1;

const flushStreamBatch = (key: string, entry: QueueEntry<unknown>): void => {
  const state = streamThrottleState[key];
  if (!state || state.pendingChunks.length === 0) return;
  entry.streamChunks = state.pendingChunks.slice();
  state.pendingChunks.length = 0;
  entry.setUpdateTrigger?.(updater);
};

const findEntry = (cacheName: string | undefined, hookId: string | undefined) =>
  cacheName
    ? responseQueue[normalizeKey(cacheName)]
    : hookId
      ? (Object.values(responseQueue).find((e) => e.hookId === hookId) ?? null)
      : null;

const finalizeEntry = (entry: QueueEntry<unknown>): void => {
  entry.requestId = null;
  entry.setUpdateTrigger?.(updater);
};

const getApiWorker = (): Worker => {
  if (apiWorker) return apiWorker;
  apiWorker = createApiWorker();
  return apiWorker;
};

const ensureWorkerInitialized = (): Worker => {
  const worker = getApiWorker();
  if (workerInitialized) return worker;
  workerInitialized = true;

  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => runStaleEntryCleanup(), CLEANUP_INTERVAL_MS);
  }

  // Worker always sends error ({ message: string }). Entry is found by cacheName or hookId.
  // Stream responses: start → chunk(s) → end; we accumulate chunks then set data = new Blob(chunks) on end.
  worker.onmessage = (event: MessageEvent<WorkerMessagePayload>) => {
    const msg = event.data;
    const cacheName = msg.cacheName;
    const hookId = msg.hookId;
    const error = msg.error;
    const key = cacheName ? normalizeKey(cacheName) : "";

    if ("stream" in msg && msg.stream) {
      const entry = findEntry(cacheName, hookId);
      if (!entry) return;
      const batchSize = toNumber(entry.streamChunkBatchSize, DEFAULT_CHUNK_BATCH);
      switch (msg.stream) {
        case "start": {
          streamAccumulators[key] = { chunks: [], meta: msg.meta ?? null };
          streamThrottleState[key] = { pendingChunks: [] };
          entry.streamChunks = [];
          entry.meta = msg.meta ?? null;
          entry.setUpdateTrigger?.(updater);
          return;
        }
        case "resume":
          if (!streamAccumulators[key]) streamAccumulators[key] = { chunks: [], meta: msg.meta ?? null };
          else if (msg.meta) streamAccumulators[key].meta = msg.meta;
          if (!streamThrottleState[key]) streamThrottleState[key] = { pendingChunks: [] };
          if (msg.meta) entry.meta = msg.meta ?? null;
          return;
        case "chunk": {
          const acc = streamAccumulators[key];
          const throttle = streamThrottleState[key];
          if (acc && msg.data) acc.chunks.push(msg.data);
          if (throttle && msg.data) {
            throttle.pendingChunks.push(msg.data);
            if (throttle.pendingChunks.length >= batchSize) {
              flushStreamBatch(key, entry);
            }
          }
          return;
        }
        case "end": {
          const acc = streamAccumulators[key];
          const throttle = streamThrottleState[key];
          if (throttle?.pendingChunks.length) flushStreamBatch(key, entry);
          delete streamThrottleState[key];
          delete streamAccumulators[key];
          const errMsg = error?.message ?? "";
          if (errMsg !== "") {
            entry.error = errMsg;
          } else if (acc) {
            entry.data = new Blob(acc.chunks, acc.meta?.contentType ? { type: acc.meta.contentType } : undefined);
            entry.meta = acc.meta ?? null;
            entry.error = null;
            entry.lastActivityAt = Date.now();
          }
          entry.loading = false;
          finalizeEntry(entry);
          return;
        }
      }
    }

    const entry = findEntry(cacheName, hookId);
    if (!entry) return;

    const message = error?.message ?? "";
    if (message !== "") {
      entry.error = message;
      entry.loading = false;
    } else {
      entry.data = msg.data ?? null;
      entry.meta = msg.meta ?? null;
      entry.lastActivityAt = Date.now();
      entry.error = null;
      entry.loading = false;
    }
    finalizeEntry(entry);
  };

  return worker;
};

// ============================================================================
// HOOK
// ============================================================================

export type { RequestConfig, UseApiWorkerConfig, UseApiWorkerReturn } from "../types/types";

export const useApiWorker = <T>(config: UseApiWorkerConfig): UseApiWorkerReturn<T> => {
  const { cacheName, request: requestConfig, data: configData, runMode = "auto", enabled = true } = config;

  const worker = ensureWorkerInitialized();

  const hookIdRef = useRef<string>("");
  const queueKey = normalizeKey(cacheName);

  const hasExecutedRef = useRef(false);
  const [, setUpdateTrigger] = useState(0);

  let storeEntry = responseQueue[queueKey];

  if (!storeEntry) {
    const hookId = uniqueId();
    storeEntry = responseQueue[queueKey] = {
      hookId,
      cacheName,
      data: null,
      loading: false,
      error: null,
      setUpdateTrigger: () => {},
      requestId: null,
      meta: null,
      lastActivityAt: null,
    };
    hookIdRef.current = hookId;
  } else {
    hookIdRef.current = storeEntry.hookId;
    storeEntry.lastActivityAt = Date.now();
  }
  const entry = storeEntry;
  entry.setUpdateTrigger = setUpdateTrigger;

  const hookId = hookIdRef.current;

  const deleteCache = useCallback(() => {
    if (cacheName) {
      worker.postMessage({
        dataRequest: { type: "delete", cacheName, hookId: hookIdRef.current },
      });
    }
  }, [cacheName, worker]);

  const doRequest = useCallback(() => {
    const entry = responseQueue[queueKey];
    if (!entry || entry.loading) return;
    entry.loading = true;
    entry.error = null;
    entry.lastActivityAt = Date.now();
    entry.setUpdateTrigger?.(updater);
    if (requestConfig) {
      const requestId = uniqueId();
      entry.requestId = requestId;
      const isStream = requestConfig.responseType?.toLowerCase() === "stream";
      if (isStream) {
        entry.streamChunkBatchSize = toNumber(requestConfig.streamChunkBatchSize, DEFAULT_CHUNK_BATCH);
      }
      const request =
        isStream && requestConfig.retries === undefined ? { ...requestConfig, retries: 3 } : requestConfig;
      worker.postMessage({
        dataRequest: { type: "set", cacheName, hookId, requestId, payload: configData, request },
      });
    } else {
      worker.postMessage({ dataRequest: { type: "get", cacheName, hookId } as DataRequest<unknown> });
    }
    hasExecutedRef.current = true;
  }, [queueKey, cacheName, hookId, requestConfig, configData, worker]);

  const makeRequest = useCustomCallback(() => {
    if (!enabled || (runMode === "once" && hasExecutedRef.current)) return;
    doRequest();
  }, [enabled, runMode, doRequest]);

  const hasAlreadyRunOnce = runMode === "once" && hasExecutedRef.current;
  const shouldRun = (runMode === "auto" || runMode === "once") && enabled && (requestConfig || cacheName);
  if (shouldRun && !hasAlreadyRunOnce && !entry.loading) {
    doRequest();
  }
  return {
    data: (entry.data as T) ?? null,
    meta: entry.meta ?? null,
    loading: entry.loading ?? false,
    error: entry.error ?? null,
    refetch: makeRequest,
    deleteCache,
    streamChunks: toStreamChunks(entry.streamChunks),
  };
};
