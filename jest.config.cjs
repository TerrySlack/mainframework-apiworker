const path = require("path");

module.exports = {
  transform: {
    "^.+\\.tsx?$": ["babel-jest", { configFile: "./babel.config.cjs" }],
  },
  moduleNameMapper: {
    "^@mainframework/is-deep-equal$": path.resolve(__dirname, "jest-is-deep-equal-stub.cjs"),
  },
  testRegex: "(/tests/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  testPathIgnorePatterns: ["\\.rollup\\.cache"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testEnvironment: "jsdom",
  passWithNoTests: true,
  setupFiles: ["<rootDir>/jest.worker-setup.ts"],
  globalTeardown: "<rootDir>/jest.global-teardown.cjs",
};
