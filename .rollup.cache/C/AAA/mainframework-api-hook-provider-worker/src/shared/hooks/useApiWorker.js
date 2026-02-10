// useApiWorker.ts
import { useRef, useState, useCallback, useEffect } from "react";
import { uniqueId } from "../utils/uniqueId";
import { useCustomCallback } from "./useCustomCallback";
// ============================================================================
// MODULE-LEVEL WORKER & QUEUE
// ============================================================================
const apiWorker = new Worker(new URL("../workers/api/api.worker", import.meta.url));
const STALE_ENTRY_MS = 5000;
const CLEANUP_INTERVAL_MS = 30000;
const normalizeKey = (key) => key.toLowerCase();
const cleanupState = { isDeleting: false, lastRun: 0 };
const runStaleEntryCleanup = () => {
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
const responseQueue = {};
const updater = (n) => n + 1;
// Worker message handler
apiWorker.onmessage = (event) => {
  const { data, cacheName, meta } = event.data;
  const errorPayload = event.data.error ?? event.data.data?.error;
  const errorCode = event.data.data?.code;
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
            typeof errorPayload.message === "string"
          ? errorPayload.message
          : "Unknown error";
    entry.error = {
      message,
      code: errorCode,
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
export const useApiWorker = (config) => {
  const { cacheName, request: requestConfig, data: configData, runMode = "auto", enabled = true } = config;
  const hookIdRef = useRef("");
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
    const dataRequest = requestConfig
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
      apiWorker.postMessage({ dataRequest: { type: "get", cacheName, hookId } });
    }
  }
  return {
    data: storeEntry?.data ?? null,
    meta: storeEntry?.meta ?? null,
    loading: storeEntry?.loading ?? false,
    error: storeEntry?.error ?? null,
    refetch: makeRequest,
    deleteCache,
  };
};
//# sourceMappingURL=useApiWorker.js.map
