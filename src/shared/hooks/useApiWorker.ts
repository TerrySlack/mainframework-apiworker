// useApiWorker.ts
import { useRef, useState, useCallback, useEffect } from "react";
import { uniqueId } from "../utils/uniqueId";
import type {
  DataRequest,
  QueueEntry,
  UseApiWorkerConfig,
  UseApiWorkerReturn,
  WorkerErrorKind,
  WorkerMessagePayload,
} from "../types/types";
import { useCustomCallback } from "./useCustomCallback";

// ============================================================================
// MODULE-LEVEL WORKER & QUEUE
// ============================================================================

const apiWorker = new Worker(new URL("../workers/api/api.worker", import.meta.url));

const STALE_ENTRY_MS = 5000;
const CLEANUP_INTERVAL_MS = 30000;

const normalizeKey = (key: string) => key.toLowerCase();

const cleanupState = { isDeleting: false, lastRun: 0 };

const runStaleEntryCleanup = (): void => {
  const now = Date.now();
  if (cleanupState.isDeleting || now < cleanupState.lastRun + CLEANUP_INTERVAL_MS) return;
  cleanupState.isDeleting = true;
  try {
    for (const key of Object.keys(responseQueue)) {
      const entry = responseQueue[key];
      if (!entry) continue;

      if (entry.data != null && entry.lastActivityAt != null && now - entry.lastActivityAt >= STALE_ENTRY_MS) {
        entry.loading = null;
        entry.data = null;
        entry.meta = null;
        entry.error = null;
        entry.setUpdateTrigger = null;
        entry.requestId = null;
      }
    }
  } finally {
    cleanupState.isDeleting = false;
    cleanupState.lastRun = now;
  }
};

const responseQueue: Record<string, QueueEntry<unknown>> = {};

const updater = (n: number) => n + 1;

const ERROR_KINDS: readonly WorkerErrorKind[] = ["http", "network", "validation", "aborted"];
const isWorkerErrorPayload = (d: unknown): d is { kind: string; message: string; status?: number; code?: string } =>
  !!d &&
  typeof d === "object" &&
  "kind" in d &&
  typeof (d as { kind: unknown }).kind === "string" &&
  ERROR_KINDS.includes((d as { kind: string }).kind as WorkerErrorKind) &&
  "message" in d &&
  typeof (d as { message: unknown }).message === "string";

// Worker message handler
apiWorker.onmessage = (event: MessageEvent<WorkerMessagePayload>) => {
  const { data, cacheName, meta } = event.data;
  const errorPayload = isWorkerErrorPayload(event.data.data)
    ? event.data.data
    : (event.data.error ??
      (event.data.data && typeof event.data.data === "object" && "error" in event.data.data
        ? (event.data.data as { error: unknown }).error
        : null));

  if (!cacheName) return;
  const entry = responseQueue[normalizeKey(cacheName)];
  if (!entry) return;
  if (cacheName !== "error" && normalizeKey(entry.cacheName) !== normalizeKey(cacheName)) return;

  if (errorPayload) {
    const message =
      typeof errorPayload === "string"
        ? errorPayload
        : typeof errorPayload === "object" &&
            errorPayload !== null &&
            "message" in errorPayload &&
            typeof (errorPayload as { message: unknown }).message === "string"
          ? (errorPayload as { message: string }).message
          : "Unknown error";
    entry.error = isWorkerErrorPayload(errorPayload)
      ? {
          kind: errorPayload.kind as WorkerErrorKind,
          message,
          ...(errorPayload.status !== undefined && { status: errorPayload.status }),
          ...(errorPayload.code !== undefined && { code: errorPayload.code }),
        }
      : {
          kind: "validation" as const,
          message,
          ...((event.data.data as { code?: string } | undefined)?.code !== undefined && {
            code: (event.data.data as { code?: string }).code,
          }),
        };
    entry.loading = false;
  } else {
    entry.data = data;
    entry.meta = meta ?? null;
    entry.lastActivityAt = Date.now();
    entry.error = null;
    entry.loading = false;
  }
  entry.requestId = null;
  entry.setUpdateTrigger?.(updater);
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
    responseQueue[queueKey] = {
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
    storeEntry = responseQueue[queueKey];
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
        dataRequest: { type: "delete", cacheName, hookId },
      });
    }
  }, [cacheName, hookId]);

  useEffect(() => {
    runStaleEntryCleanup();
  });

  const makeRequest = useCustomCallback(() => {
    if (!enabled || (runMode === "once" && hasExecutedRef.current)) return;
    const entry = responseQueue[queueKey];
    if (!entry || entry.loading) return;
    const requestId = uniqueId();
    entry.requestId = requestId;
    entry.loading = true;
    entry.error = null;
    entry.lastActivityAt = Date.now();
    entry.setUpdateTrigger?.(updater);

    const dataRequest: DataRequest<unknown> = requestConfig
      ? {
          type: "set",
          cacheName,
          hookId,
          requestId,
          payload: configData,
          request: requestConfig,
        }
      : { type: "get", cacheName, hookId };

    apiWorker.postMessage({ dataRequest });
    hasExecutedRef.current = true;
  }, [hookId, queueKey, cacheName, requestConfig, configData, runMode, enabled, setUpdateTrigger]);

  const shouldRun = (runMode === "auto" || runMode === "once") && enabled && (requestConfig || cacheName);
  if (shouldRun && !(runMode === "once" && hasExecutedRef.current) && !storeEntry.loading) {
    const now = Date.now();
    if (requestConfig) {
      makeRequest();
    } else {
      storeEntry.loading = true;
      storeEntry.error = null;
      storeEntry.lastActivityAt = now;
      if (runMode === "once") hasExecutedRef.current = true;
      setUpdateTrigger(updater);
      apiWorker.postMessage({ dataRequest: { type: "get", cacheName, hookId } as DataRequest<unknown> });
    }
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
