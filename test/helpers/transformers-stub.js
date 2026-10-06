/**
 * Stand-in for @huggingface/transformers.
 *
 * Aliased over the real package when the analyzer is bundled for tests, so
 * device negotiation and pipeline options can be observed without downloading
 * a model. State lives on globalThis because the stub is inlined into the
 * bundle and is therefore a different module instance from the test's own
 * import.
 */

/** Reset and configure stub behaviour. Call before each test. */
export function configureStub(options = {}) {
  globalThis.__transformersStub = {
    calls: [],
    /** Device names whose pipeline() call should reject. */
    failDevices: options.failDevices ?? [],
    /** Milliseconds each pipeline() call takes to resolve. */
    loadDelayMs: options.loadDelayMs ?? 0,
    /** Embedding returned by the extractor. */
    embedding: options.embedding ?? [0.1, 0.2, 0.3],
  };
  return globalThis.__transformersStub;
}

export function stubState() {
  return globalThis.__transformersStub;
}

export async function pipeline(task, model, options = {}) {
  const state = globalThis.__transformersStub;
  if (!state) throw new Error("transformers stub used before configureStub()");

  state.calls.push({ task, model, device: options.device, dtype: options.dtype });

  if (state.loadDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, state.loadDelayMs));
  }

  if (state.failDevices.includes(options.device)) {
    throw new Error(`stub: device '${options.device}' unavailable`);
  }

  const extractor = async () => ({
    data: Float32Array.from(state.embedding),
    dims: [1, state.embedding.length],
  });
  extractor.__stubDevice = options.device;
  return extractor;
}

export default { pipeline };
