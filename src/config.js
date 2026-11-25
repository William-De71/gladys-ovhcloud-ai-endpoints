// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the administrator in Gladys from the `config_schema` of the
// manifest; the SDK fetches it (`gladys.getConfig()`) and notifies every
// change (`gladys.onConfigUpdated()`). This module provides the defaults and
// normalizes what arrives, so the rest of the code never deals with
// `undefined`, a number typed as a string, or a model the select no longer
// offers.
// -----------------------------------------------------------------------------

/**
 * The models offered in the Configuration screen, with what is known about
 * them on AI Endpoints (catalog GET /models, docs.ovhcloud.com guides and
 * the catalog pages, requests sent on 2026-11-25). AI Endpoints has no
 * "latest" aliases: these are the model ids, which OVHcloud retires with three
 * months of notice (docs: troubleshooting, "x-warning" header, then 404);
 * "Other model" covers the rest and the successors.
 *
 *   - `efforts`  the `reasoning_effort` values the model accepts, from the
 *                least to the most; empty: the model does not reason and gets
 *                none. A refusal (400) makes the chat drop it anyway;
 *   - `images`   it reads the images of the chat;
 *   - `maxOutput` the largest answer the catalog announces.
 *
 * Checked on the real API: GPT-OSS 120B calls tools with `reasoning_effort`
 * low and returns its reasoning in `message.reasoning`; Mistral Small 3.2
 * calls tools; Qwen 3.6 35B accepts `reasoning_effort: "none"`. Qwen 3.5 397B
 * reads images (catalog page: "Function calling, Vision, Reasoning").
 */
export const MODELS = {
  'gpt-oss-120b': {
    name: 'GPT-OSS 120B',
    efforts: ['low', 'medium', 'high'],
    images: false,
    maxOutput: 131_072,
  },
  'Qwen3.5-397B-A17B': {
    name: 'Qwen 3.5 397B',
    efforts: ['none', 'low', 'medium', 'high'],
    images: true,
    maxOutput: 262_144,
  },
  'Mistral-Small-3.2-24B-Instruct-2506': {
    name: 'Mistral Small 3.2',
    efforts: [],
    images: false,
    maxOutput: 131_072,
  },
  'qwen3.6-35b-a3b': {
    name: 'Qwen 3.6 35B',
    efforts: ['none', 'low', 'medium', 'high'],
    images: false,
    maxOutput: 65_536,
  },
  'gpt-oss-20b': {
    name: 'GPT-OSS 20B',
    efforts: ['low', 'medium', 'high'],
    images: false,
    maxOutput: 65_536,
  },
};

/** The values of each select, in the order of the manifest. */
export const CHAT_MODELS = [
  'gpt-oss-120b',
  'Qwen3.5-397B-A17B',
  'Mistral-Small-3.2-24B-Instruct-2506',
  'qwen3.6-35b-a3b',
  'gpt-oss-20b',
];
export const ROUTER_MODELS = [
  'Mistral-Small-3.2-24B-Instruct-2506',
  'gpt-oss-20b',
  'qwen3.6-35b-a3b',
  'gpt-oss-120b',
];

/** The model that reads images, named when another one is asked to. */
export const IMAGE_MODEL = 'Qwen3.5-397B-A17B';

export const CUSTOM_MODEL = 'custom';

/** The reasoning levels of the configuration (`reasoning` select). */
export const REASONING_LEVELS = ['none', 'low', 'medium', 'high'];

/** A model id typed by hand, as the catalog writes them (`Meta-Llama-3_3-70B-Instruct`). */
const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;

/** Bounds of the `max_tokens` field, mirrored by the manifest. */
export const MAX_TOKENS_MIN = 1024;
export const MAX_TOKENS_MAX = 32000;

// Defaults: they MUST stay consistent with the `default` values declared in
// the `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // The AI Endpoints API key. A `secret` field: no default, never logged.
  api_key: '',
  // The model of the chat, the scene `ai.ask` action and the weekly digest.
  model: 'gpt-oss-120b',
  // The model of the intent router, which runs before every chat turn and must
  // answer within 20 s.
  fast_model: 'Mistral-Small-3.2-24B-Instruct-2506',
  // The id used by a select set to "custom".
  custom_model: '',
  // How hard the chat model thinks.
  reasoning: 'low',
  // Output budget of one answer (reasoning included): a ceiling, only the
  // tokens written are billed.
  max_tokens: 8192,
};

/**
 * @description Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] - Config returned by the SDK.
 * @returns {object} The normalized config.
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  const customModel = String(config.custom_model ?? '').trim();
  return {
    api_key: String(config.api_key ?? '').trim(),
    model: pickModel(config.model, CHAT_MODELS, DEFAULT_CONFIG.model),
    fast_model: pickModel(config.fast_model, ROUTER_MODELS, DEFAULT_CONFIG.fast_model),
    custom_model: MODEL_ID_PATTERN.test(customModel) ? customModel : '',
    reasoning: REASONING_LEVELS.includes(config.reasoning)
      ? config.reasoning
      : DEFAULT_CONFIG.reasoning,
    max_tokens: clampInteger(config.max_tokens, MAX_TOKENS_MIN, MAX_TOKENS_MAX),
  };
}

/**
 * @description The model id to call for a select value.
 * @param {object} config - The normalized config.
 * @param {'model'|'fast_model'} key - Which select.
 * @returns {string|null} The API model id, null when "custom" has no id.
 */
export function resolveModel(config, key) {
  const value = config[key];
  if (value === CUSTOM_MODEL) {
    return config.custom_model || null;
  }
  return value;
}

/**
 * @description The display name of a model id.
 * @param {string} id - An API model id.
 * @returns {string} "GPT-OSS 120B", or the id itself.
 */
export function presetName(id) {
  return MODELS[id]?.name ?? id;
}

/**
 * @description The `reasoning_effort` to send for a model and a wanted level.
 * A known model gets the closest level it accepts (GPT-OSS cannot turn
 * reasoning off: `none` becomes `low`), a model that does not reason gets
 * nothing; an unknown one gets nothing for
 * `none`, else the level as asked (a 400 makes the chat drop it).
 * @param {string|null} model - The model id.
 * @param {string} level - `none`, `low`, `medium` or `high`.
 * @returns {string|undefined} The effort, undefined to send none.
 */
export function effortFor(model, level) {
  const efforts = MODELS[model]?.efforts;
  if (!efforts) {
    return level === 'none' ? undefined : level;
  }
  if (efforts.length === 0) {
    // A model that does not reason gets no parameter at all.
    return undefined;
  }
  if (efforts.includes(level)) {
    return level;
  }
  const order = REASONING_LEVELS;
  const wanted = order.indexOf(level);
  // The closest level the model accepts; on a tie, the lower one (faster).
  return [...efforts].sort(
    (a, b) =>
      Math.abs(order.indexOf(a) - wanted) - Math.abs(order.indexOf(b) - wanted) ||
      order.indexOf(a) - order.indexOf(b),
  )[0];
}

/**
 * @description The `max_completion_tokens` to send: the configuration, raised
 * to what the caller asks, bounded by the model.
 * @param {string|null} model - The model id.
 * @param {number} configured - The `max_tokens` of the configuration.
 * @param {number} [asked] - The `max_tokens` of the core request.
 * @param {number|null} [catalogMax] - The largest answer the catalog gives
 * for a model typed by hand.
 * @returns {number} Tokens.
 */
export function outputBudget(model, configured, asked = 0, catalogMax = null) {
  const wanted = Math.min(MAX_TOKENS_MAX, Math.max(configured, Number(asked) || 0));
  const bound = MODELS[model]?.maxOutput ?? (catalogMax > 0 ? catalogMax : MAX_TOKENS_MAX);
  return Math.min(wanted, bound);
}

/**
 * @description A select value kept when offered by that select, else the default.
 * @param {unknown} value - The value.
 * @param {Array<string>} offered - The values of the select.
 * @param {string} fallback - The default.
 * @returns {string} A model id or "custom".
 */
function pickModel(value, offered, fallback) {
  if (value === CUSTOM_MODEL || offered.includes(value)) {
    return value;
  }
  return fallback;
}

/**
 * @description An integer within bounds.
 * @param {unknown} value - The value.
 * @param {number} min - The minimum.
 * @param {number} max - The maximum.
 * @returns {number} The integer.
 */
function clampInteger(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return DEFAULT_CONFIG.max_tokens;
  }
  return Math.min(max, Math.max(min, number));
}
