// -----------------------------------------------------------------------------
// Connection status and the "Test the connection" action.
//
// The status shown in the Configuration screen says whether AI Endpoints can
// answer: a key is there, AI Endpoints accepts it and both chosen models are
// language models of its catalog (GET /models with the key, which spends
// nothing: a wrong key is a 403). Only the test action spends a few
// tokens, on purpose, to show a real answer and its time.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { effortFor, resolveModel } from './config.js';
import { ERROR_KINDS, OvhError } from './ovh-api.js';
import { all, t } from './i18n.js';

const logger = createLogger({ name: 'connection' });

const TEST_TIMEOUT_MS = 25_000;
const ROLES = [
  ['chat', 'model'],
  ['router', 'fast_model'],
];

/**
 * @description The localized reason of a failure.
 * @param {unknown} err - The error.
 * @param {string} [name] - The display name of the model concerned.
 * @returns {object} `{ en, fr, de, es }`.
 */
export function failureMessage(err, name) {
  const kind = err instanceof OvhError ? err.kind : ERROR_KINDS.SERVER;
  switch (kind) {
    case ERROR_KINDS.AUTH:
      return all('statusBadKey');
    case ERROR_KINDS.PROJECT:
      return all('statusProject');
    case ERROR_KINDS.MODEL:
      return all('statusNoModel', { model: name ?? '?' });
    case ERROR_KINDS.RATE_LIMIT:
      return all('statusRateLimited');
    case ERROR_KINDS.TOO_LARGE:
      return all('statusTooLarge');
    case ERROR_KINDS.UNREACHABLE:
    case ERROR_KINDS.TIMEOUT:
      return all('statusUnreachable');
    default:
      return all('statusApiError', { detail: err?.message ?? String(err) });
  }
}

/**
 * @description Check the configuration against AI Endpoints, without generating text.
 * @param {object} client - The AI Endpoints client.
 * @param {object} catalog - The model catalog.
 * @param {object} config - The normalized config.
 * @returns {Promise<{ ok: boolean, message?: object, warnings: Array<object> }>} The result.
 */
export async function checkConnection(client, catalog, config) {
  if (!config.api_key) {
    return { ok: false, message: all('statusNoKey'), warnings: [] };
  }
  const warnings = [];
  for (const [, field] of ROLES) {
    if (!resolveModel(config, field)) {
      return { ok: false, message: all('statusNoCustom'), warnings };
    }
  }
  try {
    catalog.accept(await client.models());
  } catch (err) {
    logger.warn(`Key check failed: ${err?.message ?? err}`);
    return { ok: false, message: failureMessage(err), warnings };
  }
  for (const model of new Set(ROLES.map(([, field]) => resolveModel(config, field)))) {
    const entry = catalog.lookup(model);
    if (catalog.loaded() && !entry) {
      return { ok: false, message: all('statusNoModel', { model }), warnings };
    }
    if (entry && !entry.chat) {
      // A speech, image or embedding model typed by hand.
      return { ok: false, message: all('statusNotChat', { model }), warnings };
    }
  }
  return { ok: true, warnings };
}

/**
 * @description The "Test the connection" action: one tiny real answer from
 * each model.
 * @param {object} client - The AI Endpoints client.
 * @param {object} catalog - The model catalog.
 * @param {object} config - The normalized config.
 * @param {() => number} [now] - Clock.
 * @returns {Promise<object>} The message shown under the button, `{ en, fr, de, es }`.
 */
export async function testConnection(client, catalog, config, now = Date.now) {
  if (!config.api_key) {
    return all('statusNoKey');
  }
  const lines = [];
  const tested = new Map();
  for (const [role, field] of ROLES) {
    const model = resolveModel(config, field);
    if (!model) {
      lines.push((language) => `${t(`role_${role}`, language)} — ${t('statusNoCustom', language)}`);
      continue;
    }
    if (tested.has(model)) {
      const same = tested.get(model);
      lines.push((language) => `${t(`role_${role}`, language)} — ${same(language)}`);
      continue;
    }
    const name = catalog.name(model);
    const started = now();
    let line;
    try {
      const effort = effortFor(model, 'none');
      await client.chat(
        {
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          ...(effort ? { reasoning_effort: effort } : {}),
        },
        { timeoutMs: TEST_TIMEOUT_MS, retries: false },
      );
      const seconds = (now() - started) / 1000;
      const limits = client.limits(model);
      const left = limits?.remaining;
      line = (language) =>
        [
          t('testAnswered', language, {
            model: name,
            seconds: seconds.toLocaleString(language, { maximumFractionDigits: 1 }),
          }),
          Number.isFinite(left) && Number.isFinite(limits.limit)
            ? t('testRequestsLeft', language, { left, limit: limits.limit })
            : '',
        ]
          .filter(Boolean)
          .join(' ');
    } catch (err) {
      logger.warn(`Test of ${model} failed: ${err?.message ?? err}`);
      const reason = failureMessage(err, name);
      line = (language) => reason[language];
    }
    tested.set(model, line);
    lines.push((language) => `${t(`role_${role}`, language)} — ${line(language)}`);
  }
  return all((language) => lines.map((line) => line(language)).join('\n'));
}
