/**
 * Mocks global Worker so useApiWorker tests can run without a real worker.
 * Tests can simulate worker responses via __WORKER_MOCK__.dispatchMessage(payload).
 */
import nodeFetch from "node-fetch";

const mockPostMessage = jest.fn<
  ReturnType<typeof Worker.prototype.postMessage>,
  Parameters<typeof Worker.prototype.postMessage>
>();
let onmessageHandler: ((e: MessageEvent) => void) | null = null;

const mockWorkerInstance = {
  postMessage: mockPostMessage,
  get onmessage() {
    return onmessageHandler;
  },
  set onmessage(fn: ((e: MessageEvent) => void) | null) {
    onmessageHandler = fn;
  },
  terminate: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
};

function MockWorker(this: typeof mockWorkerInstance) {
  return mockWorkerInstance;
}

const workerMock = {
  getPostMessageCalls: (): unknown[][] => mockPostMessage.mock.calls as unknown[][],
  clearPostMessage: () => mockPostMessage.mockClear(),
  /** Simulate a message from the worker (success or error). */
  dispatchMessage(payload: Record<string, unknown>) {
    if (onmessageHandler) {
      onmessageHandler({ data: payload } as MessageEvent);
    }
  },
  get postMessage() {
    return mockPostMessage;
  },
};

(globalThis as unknown as { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;
(globalThis as unknown as { __WORKER_MOCK__: typeof workerMock }).__WORKER_MOCK__ = workerMock;

// Ensure global fetch is available for all tests
interface GlobalWithFetch {
  fetch?: typeof fetch;
}

if (typeof (globalThis as GlobalWithFetch).fetch !== "function") {
  (globalThis as GlobalWithFetch).fetch = nodeFetch as unknown as typeof fetch;
}

const g = globalThis as GlobalWithFetch & { __FETCH_IS_STUB__?: boolean };
const proc =
  typeof process !== "undefined" ? (process as NodeJS.Process & { __JEST_REAL_FETCH__?: typeof fetch }) : undefined;
if (proc?.__JEST_REAL_FETCH__) {
  g.fetch = proc.__JEST_REAL_FETCH__;
  g.__FETCH_IS_STUB__ = false;
} else {
  g.__FETCH_IS_STUB__ = true;
}
