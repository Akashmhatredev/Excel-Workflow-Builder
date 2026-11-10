/**
 * workers/parse.worker.js: the data engine's home. See lib/workerClient.js for the protocol.
 *
 * Each handler receives (payload, ctx) and returns the result object described
 * in CONTRACTS.md. ctx.progress({ phase, percent, message }) reports progress.
 * Throw an Error with a `.code` (ERROR_CODES in lib/workerClient.js) for user-facing failures.
 * Results that carry `bytes` (Uint8Array) are transferred, not copied.
 */

const datasets = new Map(); // datasetId -> { fileName, fileSize, workbook, table }

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const notImplemented = (name) => async () => {
  throw fail("NOT_IMPLEMENTED", `${name} is not implemented yet.`);
};

const handlers = {
  parseFile: notImplemented("parseFile"),
  loadTable: notImplemented("loadTable"),
  getRows: notImplemented("getRows"),
  runPreview: notImplemented("runPreview"),
  buildOutput: notImplemented("buildOutput"),
  buildZip: notImplemented("buildZip"),
  disposeDataset: async ({ datasetId }) => {
    datasets.delete(datasetId);
    return { ok: true };
  },
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  const handler = handlers[type];
  const ctx = { progress: (progress) => self.postMessage({ id, progress }) };
  try {
    if (!handler) throw fail("NOT_IMPLEMENTED", `Unknown request "${type}".`);
    const result = await handler(payload || {}, ctx);
    const transfer = result && result.bytes && result.bytes.buffer ? [result.bytes.buffer] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        code: (error && error.code) || "UNKNOWN",
        message: (error && error.message) || "Something went wrong while processing the file.",
      },
    });
  }
};
