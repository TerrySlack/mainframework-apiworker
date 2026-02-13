/**
 * Jest transform that replaces import.meta.url in useApiWorker.ts so it can run in Node.
 * Then delegates to ts-jest for TypeScript compilation.
 */
const tsJest = require("ts-jest").default;

const tsJestTransformer = tsJest.createTransformer();

const FAKE_URL = "'file:///fake-worker.js'";

module.exports = {
  process(src, filename, transformOptions) {
    let source = src;
    if (
      (filename.includes("useApiWorker.ts") || filename.includes("createApiWorker.ts")) &&
      source.includes("import.meta.url")
    ) {
      source = source.replace(/import\.meta\.url/g, FAKE_URL);
    }
    return tsJestTransformer.process(source, filename, transformOptions);
  },
};
