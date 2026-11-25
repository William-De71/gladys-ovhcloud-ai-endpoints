// -----------------------------------------------------------------------------
// The catalog of AI Endpoints (GET /models, about thirty entries: language
// models, but also speech, image and embedding models).
//
// Each entry has the id, the owner, the context length, the largest answer
// and the prices in USD per token (`pricing.prompt`, `pricing.completion`,
// `pricing.input_cache_reads`): no name, no capabilities. The list is used to
// tell the administrator at once that a model id is wrong, retired or not a
// language model, to bound the answer of a model typed by hand, and to
// estimate what the requests cost. Names and capabilities of the models of the
// selects come from config.js.
//
// Read at the first need and every 12 hours. A failure keeps the last list:
// the catalog helps, it is never needed to answer.
// -----------------------------------------------------------------------------

import { presetName } from './config.js';

export const CATALOG_TTL_MS = 12 * 3600_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

/**
 * @description The part of a catalog entry kept in memory.
 * @param {object} model - An entry of GET /models.
 * @returns {object} `{ id, chat, context, maxOutput, price }`, `price` in USD
 * per million tokens `{ input, output, cached }` (null when unknown).
 */
export function summarize(model) {
  // The catalog writes "0" for every model: a cache price it does not give,
  // not free tokens. The cached tokens are then counted at the input price,
  // so the estimate never comes out lower than the bill.
  const cachePrice = (value) => (value > 0 ? value : null);
  const number = (value) =>
    value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  const perMillion = (value) => {
    const n = number(value);
    return n === null ? null : Math.round(n * 1e6 * 1e6) / 1e6;
  };
  const context = number(model?.context_length);
  const maxOutput = number(model?.max_completion_tokens);
  const input = perMillion(model?.pricing?.prompt);
  const output = perMillion(model?.pricing?.completion);
  return {
    id: String(model?.id ?? ''),
    // Speech, image and embedding models announce no answer length.
    chat: context > 0 && maxOutput > 0,
    context,
    maxOutput,
    price:
      input === null && output === null
        ? null
        : {
            input: input ?? 0,
            output: output ?? 0,
            cached: cachePrice(perMillion(model?.pricing?.input_cache_reads)),
          },
  };
}

/**
 * @description Build the catalog cache.
 * @param {object} options - Options.
 * @param {() => Promise<Array<object>>} options.fetchModels - `client.models`.
 * @param {() => number} [options.now] - Clock.
 * @param {(err: Error) => void} [options.onError] - Failures (logged).
 * @returns {object} `{ refresh, ensure, lookup, name, loaded, accept }`.
 */
export function createCatalog({ fetchModels, now = Date.now, onError = () => {} }) {
  let entries = new Map();
  let loadedAt = 0;
  let failedAt = 0;
  let pending = null;

  /**
   * @description Keep a list read elsewhere (the key check reads it too).
   * @param {Array<object>} models - The entries of GET /models.
   */
  function accept(models) {
    if (Array.isArray(models) && models.length > 0) {
      entries = new Map(models.map((model) => [String(model.id), summarize(model)]));
      loadedAt = now();
    }
  }

  async function refresh() {
    if (pending) {
      return pending;
    }
    pending = (async () => {
      try {
        accept(await fetchModels());
      } catch (err) {
        failedAt = now();
        onError(err);
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  return {
    refresh,
    accept,

    /**
     * @description The list, read again when older than 12 hours (and not
     * after a failure of less than 10 minutes).
     * @returns {Promise<void>} When it is as fresh as it can be.
     */
    async ensure() {
      const stale = entries.size === 0 || now() - loadedAt > CATALOG_TTL_MS;
      const cooling = failedAt > 0 && now() - failedAt < RETRY_AFTER_FAILURE_MS;
      if (stale && !cooling) {
        await refresh();
      }
    },

    /**
     * @param {string|null} id - A model id.
     * @returns {object|undefined} Its summary.
     */
    lookup(id) {
      return id ? entries.get(id) : undefined;
    },

    /**
     * @param {string|null} id - A model id.
     * @returns {object|null} Its prices in USD per million tokens.
     */
    price(id) {
      return (id && entries.get(id)?.price) || null;
    },

    /**
     * @param {string|null} id - A model id.
     * @returns {string} Its display name ("GPT-OSS 120B"), or the id.
     */
    name(id) {
      return id ? presetName(id) : '–';
    },

    /** @returns {boolean} Whether a list was read. */
    loaded() {
      return entries.size > 0;
    },
  };
}
