/// <reference types="jest" />
import { createApiWorker } from "./createApiWorker";

describe("createApiWorker", () => {
  it("returns an object with postMessage", () => {
    const worker = createApiWorker();
    expect(worker).toHaveProperty("postMessage");
    expect(typeof worker.postMessage).toBe("function");
  });

  it("returns an object with onmessage", () => {
    const worker = createApiWorker();
    expect(worker).toHaveProperty("onmessage");
  });
});
