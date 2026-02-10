/**
 * Mocks global Worker so useApiWorker tests can run without a real worker.
 * Tests can simulate worker responses via __WORKER_MOCK__.dispatchMessage(payload).
 */
const mockPostMessage = jest.fn<typeof Worker.prototype.postMessage>();
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
