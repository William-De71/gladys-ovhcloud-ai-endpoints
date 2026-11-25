// -----------------------------------------------------------------------------
// Client of OVHcloud AI Endpoints
// (https://oai.endpoints.kepler.ai.cloud.ovh.net/v1, OpenAI compatible).
//
// Plain fetch, no SDK: two endpoints only —
//   - POST /chat/completions   the assistant
//   - GET  /models             the catalog (ids, context, prices). Without a
//                              key it answers to anyone; with a wrong key it
//                              answers 403: it doubles as the key check and
//                              spends nothing.
//
// Every call runs under a deadline. A 429 or a 5xx is retried while the
// deadline leaves room for it, honouring Retry-After; anything else fails at
// once with an OvhError that says what went wrong without echoing the key.
//
// What the real API answered (2026-11-25, captured without a key or with a
// made-up one):
//   - a wrong key: 403 {"message":"Forbidden: authentication failed. Please
//     generate a new one at https://kepler.ai.cloud.ovh.net/…"} — not a 401;
//   - over the limit: 429 {"message":"API rate limit exceeded",
//     "request_id":"…"}, with Retry-After in seconds;
//   - the limits of every answer in the IETF draft headers `ratelimit-limit`,
//     `ratelimit-remaining`, `ratelimit-reset` (seconds). Documented limit with
//     a key: 400 requests a minute, per Public Cloud project and per model.
//   - a refused parameter: {"message":"feature '…' is not currently supported"}.
// -----------------------------------------------------------------------------

export const DEFAULT_BASE_URL = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';

/** The error kinds, also the `kind` variable of the `error` scene trigger. */
export const ERROR_KINDS = {
  AUTH: 'auth',
  PROJECT: 'project',
  MODEL: 'model',
  RATE_LIMIT: 'rate_limit',
  TOO_LARGE: 'too_large',
  REQUEST: 'request',
  SERVER: 'server',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
};

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 8000;
const MAX_ATTEMPTS = 3;

export class OvhError extends Error {
  /**
   * @param {string} kind - One of ERROR_KINDS.
   * @param {string} message - What went wrong (never the key).
   * @param {object} [details] - `{ status, retryAfterMs, code }`.
   */
  constructor(kind, message, { status = null, retryAfterMs = null, code = null } = {}) {
    super(message);
    this.name = 'OvhError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

/**
 * @description The kind of a failure, from its HTTP status, the `code` of the
 * error body (when there is one) and its message.
 * @param {number} status - The HTTP status.
 * @param {string|null} [code] - `error.code`, rarely sent.
 * @param {string} [message] - The message of the body.
 * @returns {string} One of ERROR_KINDS.
 */
export function kindOf(status, code = null, message = '') {
  const text = String(message ?? '');
  // A key of a Public Cloud project in Discovery mode, without a payment
  // method (docs: troubleshooting, "Resource tag 'discovery' is forbidden").
  if (/discovery/i.test(text)) {
    return ERROR_KINDS.PROJECT;
  }
  if (
    status === 401 ||
    (status === 403 && /authenticat|token|api key|forbidden/i.test(text)) ||
    code === 'invalid_api_key'
  ) {
    return ERROR_KINDS.AUTH;
  }
  if (
    status === 404 ||
    code === 'model_not_found' ||
    /model .*(not found|does not exist)/i.test(text)
  ) {
    return ERROR_KINDS.MODEL;
  }
  if (status === 403) {
    return ERROR_KINDS.AUTH;
  }
  if (status === 413) {
    // The body is over 2 MB (10 MB for the vision models): images, mostly.
    return ERROR_KINDS.TOO_LARGE;
  }
  if (status === 429) {
    return ERROR_KINDS.RATE_LIMIT;
  }
  if (status === 408) {
    return ERROR_KINDS.TIMEOUT;
  }
  if (status >= 500) {
    return ERROR_KINDS.SERVER;
  }
  // 400 bad request, 422: this request only.
  return ERROR_KINDS.REQUEST;
}

/**
 * @description Hide what looks like a key.
 * @param {string} text - A text.
 * @returns {string} The text, keys masked.
 */
export function maskKeys(text) {
  return (
    String(text ?? '')
      .replace(/Bearer\s+\S+/gi, 'Bearer ***')
      // The keys are long JWT-like tokens (three base64url parts).
      .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '***')
      // The 403 hands out a long sign-in link: useless in a status line.
      .replace(/\s*Please generate a new one at \S+/i, '')
  );
}

/**
 * @description The message of an error body, short and without secrets.
 * @param {unknown} body - The parsed body, or the raw text.
 * @returns {string} The message.
 */
export function errorMessageOf(body) {
  let message = '';
  if (typeof body === 'string') {
    message = body;
  } else if (body && typeof body === 'object') {
    // OVHcloud answers `{ message }`; the OpenAI shape `{ error: { message } }`
    // is read too, in case a model server answers on its own.
    const error = body.error && typeof body.error === 'object' ? body.error : body;
    const candidate = error.message ?? body.message ?? body.detail ?? body.error;
    message = typeof candidate === 'string' ? candidate : JSON.stringify(candidate ?? '');
  }
  return maskKeys(message).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * @description Milliseconds asked by a Retry-After header.
 * @param {string|null} value - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Milliseconds, null when absent or unreadable.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * @description The rate limit of an answer (`ratelimit-limit`,
 * `ratelimit-remaining`, `ratelimit-reset` in seconds).
 * @param {Headers} headers - The headers of the answer.
 * @param {number} now - Now (ms).
 * @returns {object|null} `{ at, limit, remaining, resetAt }`.
 */
export function readLimits(headers, now = Date.now()) {
  const number = (name) => {
    const raw = headers?.get?.(name);
    const value = Number(raw);
    return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(value) ? value : null;
  };
  const limit = number('ratelimit-limit');
  const remaining = number('ratelimit-remaining');
  if (limit === null && remaining === null) {
    return null;
  }
  const reset = number('ratelimit-reset');
  return { at: now, limit, remaining, resetAt: reset === null ? null : now + reset * 1000 };
}

/**
 * @description Build a client.
 * @param {object} options - Options.
 * @param {() => string} options.getApiKey - The current API key.
 * @param {string} [options.baseUrl] - The API root (tests point it to a fake).
 * @param {typeof fetch} [options.fetchImpl] - fetch.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Waiting (tests skip it).
 * @param {() => number} [options.now] - Clock.
 * @returns {object} `{ chat, models, limits }`.
 */
export function createOvhClient({
  getApiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const root = baseUrl.replace(/\/+$/, '');
  // The last rate limit seen, by model.
  const limits = new Map();

  /**
   * @description One HTTP call, retried on 429 / 5xx / network while the
   * deadline allows.
   * @param {string} method - GET or POST.
   * @param {string} path - Path under /v1.
   * @param {object} [options] - `{ body, timeoutMs, retries }`.
   * @returns {Promise<object>} The parsed JSON body.
   */
  async function request(method, path, { body, timeoutMs = 30_000, retries = true } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
      // Without a key the API allows one request a year per model and per
      // address (seen 2026-11-25): never worth trying.
      throw new OvhError(ERROR_KINDS.AUTH, 'No AI Endpoints API key in the configuration');
    }
    const deadline = now() + timeoutMs;
    let lastError = null;
    for (let attempt = 1; attempt <= (retries ? MAX_ATTEMPTS : 1); attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        break;
      }
      try {
        return await once(method, path, body, apiKey, remaining);
      } catch (err) {
        lastError = err;
        const retryable =
          err.kind === ERROR_KINDS.RATE_LIMIT ||
          err.kind === ERROR_KINDS.SERVER ||
          err.kind === ERROR_KINDS.UNREACHABLE;
        if (!retryable || !retries || attempt === MAX_ATTEMPTS) {
          throw err;
        }
        const wait = err.retryAfterMs ?? RETRY_BASE_MS * 2 ** (attempt - 1);
        // A long wait asked by the API, or no room left for the wait and a
        // useful answer: fail now, with the real reason, rather than later
        // with a timeout.
        if (wait > RETRY_MAX_MS || now() + wait + 1000 >= deadline) {
          throw err;
        }
        await sleep(wait);
      }
    }
    throw (
      lastError ??
      new OvhError(ERROR_KINDS.TIMEOUT, `No answer within ${Math.round(timeoutMs / 1000)} s`)
    );
  }

  async function once(method, path, body, apiKey, timeoutMs) {
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new OvhError(
          ERROR_KINDS.TIMEOUT,
          `No answer within ${Math.round(timeoutMs / 1000)} s`,
        );
      }
      throw new OvhError(
        ERROR_KINDS.UNREACHABLE,
        `Cannot reach AI Endpoints (${err?.cause?.code ?? err?.message ?? 'network error'})`,
      );
    }
    if (typeof body?.model === 'string') {
      const seen = readLimits(response.headers, now());
      if (seen) {
        limits.set(body.model, seen);
      }
    }
    const text = await response.text().catch(() => '');
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = errorMessageOf(parsed ?? text) || response.statusText || 'error';
      const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : null;
      throw new OvhError(
        kindOf(response.status, code, message),
        `HTTP ${response.status}: ${message}`,
        {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), now()),
          code,
        },
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new OvhError(ERROR_KINDS.SERVER, 'AI Endpoints answered something that is not JSON', {
        status: response.status,
      });
    }
    return parsed;
  }

  return {
    /**
     * @description POST /chat/completions.
     * @param {object} body - A chat completion request.
     * @param {object} [options] - `{ timeoutMs, retries }`.
     * @returns {Promise<object>} The completion.
     */
    chat(body, options) {
      return request('POST', '/chat/completions', { ...options, body });
    },
    /**
     * @description GET /models with the key: the catalog, and the proof that
     * the key is valid (a wrong key is a 403). Spends nothing.
     * @param {object} [options] - `{ timeoutMs }`.
     * @returns {Promise<Array<object>>} The models.
     */
    async models(options) {
      const body = await request('GET', '/models', {
        timeoutMs: 15_000,
        retries: false,
        ...options,
      });
      return Array.isArray(body?.data) ? body.data : [];
    },
    /**
     * @description The last rate limit sent for a model.
     * @param {string|null} model - A model id.
     * @returns {object|null} See readLimits().
     */
    limits(model) {
      return (model && limits.get(model)) || null;
    },
  };
}
