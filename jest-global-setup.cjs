"use strict";

const path = require("path");
const { createRequire } = require("module");
const nodeRequire = createRequire(path.join(__dirname, "package.json"));
module.exports = function () {
  try {
    process.__JEST_REAL_FETCH__ = nodeRequire("undici").fetch;
  } catch {
    process.__JEST_REAL_FETCH__ = undefined;
  }
};
