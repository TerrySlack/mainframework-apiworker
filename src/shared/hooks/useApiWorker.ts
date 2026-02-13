// useApiWorker.ts
import { useRef, useState, useCallback, useEffect } from "react";
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
import { useCustomCallback } from "./useCustomCallback";

// ============================================================================
// MODULE-LEVEL WORKER & QUEUE
// ============================================================================

const apiWorker = createApiWorker();

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
      if (entry && entry.data != null && entry.lastActivityAt != null && now - entry.lastActivityAt >= STALE_ENTRY_MS) {
        entry.loading = null;
        entry.data = null;
        entry.meta = null;
        entry.error = null;
        entry.setUpdateTrigger = null;
        entry.requestId = null;
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

const updater = (n: number) => n + 1;

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

// Worker always sends error ({ message: string }). Entry is found by cacheName or hookId.
// Stream responses: start → chunk(s) → end; we accumulate chunks then set data = new Blob(chunks) on end.
apiWorker.onmessage = (event: MessageEvent<WorkerMessagePayload>) => {
  const msg = event.data;
  const cacheName = msg.cacheName;
  const hookId = msg.hookId;
  const error = msg.error;
  const key = cacheName ? normalizeKey(cacheName) : "";

  if ("stream" in msg && msg.stream) {
    const entry = findEntry(cacheName, hookId);
    if (!entry) return;
    switch (msg.stream) {
      case "start":
        streamAccumulators[key] = { chunks: [], meta: msg.meta ?? null };
        return;
      case "resume":
        if (!streamAccumulators[key]) streamAccumulators[key] = { chunks: [], meta: msg.meta ?? null };
        else if (msg.meta) streamAccumulators[key].meta = msg.meta;
        return;
      case "chunk": {
        const acc = streamAccumulators[key];
        if (acc && msg.data) acc.chunks.push(msg.data);
        return;
      }
      case "end": {
        const acc = streamAccumulators[key];
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

// ============================================================================
// HOOK
// ============================================================================

export type { RequestConfig, UseApiWorkerConfig, UseApiWorkerReturn } from "../types/types";

export const useApiWorker = <T>(config: UseApiWorkerConfig): UseApiWorkerReturn<T> => {
  const { cacheName, request: requestConfig, data: configData, runMode = "auto", enabled = true } = config;

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
  storeEntry.setUpdateTrigger = setUpdateTrigger;

  const hookId = hookIdRef.current;

  const deleteCache = useCallback(() => {
    if (cacheName) {
      apiWorker.postMessage({
        dataRequest: { type: "delete", cacheName, hookId: hookIdRef.current },
      });
    }
  }, [cacheName]);

  useEffect(() => {
    runStaleEntryCleanup();
  });

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
      const request =
        requestConfig.responseType?.toLowerCase() === "stream" && requestConfig.retries === undefined
          ? { ...requestConfig, retries: 3 }
          : requestConfig;
      apiWorker.postMessage({
        dataRequest: { type: "set", cacheName, hookId, requestId, payload: configData, request },
      });
    } else {
      apiWorker.postMessage({ dataRequest: { type: "get", cacheName, hookId } as DataRequest<unknown> });
    }
    hasExecutedRef.current = true;
  }, [queueKey, cacheName, hookId, requestConfig, configData]);

  const makeRequest = useCustomCallback(() => {
    if (!enabled || (runMode === "once" && hasExecutedRef.current)) return;
    doRequest();
  }, [enabled, runMode, doRequest]);

  const hasAlreadyRunOnce = runMode === "once" && hasExecutedRef.current;
  const shouldRun = (runMode === "auto" || runMode === "once") && enabled && (requestConfig || cacheName);
  if (shouldRun && !hasAlreadyRunOnce && !storeEntry.loading) {
    doRequest();
  }

  return {
    data: (storeEntry?.data as T) ?? null,
    meta: storeEntry?.meta ?? null,
    loading: storeEntry?.loading ?? false,
    error: storeEntry?.error ?? null,
    refetch: makeRequest,
    deleteCache,
  };
};
