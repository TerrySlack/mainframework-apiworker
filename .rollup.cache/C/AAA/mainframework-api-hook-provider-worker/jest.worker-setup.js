/**
 * Mocks global Worker so useApiWorker tests can run without a real worker.
 * Tests can simulate worker responses via __WORKER_MOCK__.dispatchMessage(payload).
 */
import nodeFetch from "node-fetch";
const mockPostMessage = jest.fn();
let onmessageHandler = null;
const mockWorkerInstance = {
    postMessage: mockPostMessage,
    get onmessage() {
        return onmessageHandler;
    },
    set onmessage(fn) {
        onmessageHandler = fn;
    },
    terminate: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
};
function MockWorker() {
    return mockWorkerInstance;
}
const workerMock = {
    getPostMessageCalls: () => mockPostMessage.mock.calls,
    clearPostMessage: () => mockPostMessage.mockClear(),
    /** Simulate a message from the worker (success or error). */
    dispatchMessage(payload) {
        if (onmessageHandler) {
            onmessageHandler({ data: payload });
        }
    },
    get postMessage() {
        return mockPostMessage;
    },
};
globalThis.Worker = MockWorker;
globalThis.__WORKER_MOCK__ = workerMock;
if (typeof globalThis.fetch !== "function") {
    globalThis.fetch = nodeFetch;
}
const g = globalThis;
const proc = typeof process !== "undefined" ? process : undefined;
if (proc?.__JEST_REAL_FETCH__) {
    g.fetch = proc.__JEST_REAL_FETCH__;
    g.__FETCH_IS_STUB__ = false;
}
else {
    g.__FETCH_IS_STUB__ = true;
}
//# sourceMappingURL=jest.worker-setup.js.map