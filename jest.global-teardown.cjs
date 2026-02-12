module.exports = async () => {
  if (typeof globalThis.__WORKER_TERMINATE__ === "function") {
    await globalThis.__WORKER_TERMINATE__();
  }
  await new Promise((r) => setTimeout(r, 200));
  process.exit(0);
};
