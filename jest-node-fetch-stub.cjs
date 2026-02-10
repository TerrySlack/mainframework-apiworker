"use strict";

const path = require("path");
const { createRequire } = require("module");
const nodeRequire = createRequire(path.join(__dirname, "package.json"));

let fetchImpl;
let hasFetch = false;
const fromEnv = (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") ||
  (typeof global !== "undefined" && typeof global.fetch === "function");
if (fromEnv) {
  fetchImpl = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
    ? globalThis.fetch
    : global.fetch;
  hasFetch = true;
} else {
  try {
    fetchImpl = nodeRequire("undici").fetch;
    hasFetch = true;
  } catch {
    fetchImpl = function fetchStub() {
      return Promise.reject(new Error("fetch not available"));
    };
  }
}
if (typeof globalThis !== "undefined") {
  globalThis.__FETCH_IS_STUB__ = !hasFetch;
  globalThis.fetch = fetchImpl;
}
if (typeof global !== "undefined") {
  global.__FETCH_IS_STUB__ = !hasFetch;
  global.fetch = fetchImpl;
}

module.exports = { __esModule: true, default: fetchImpl };
