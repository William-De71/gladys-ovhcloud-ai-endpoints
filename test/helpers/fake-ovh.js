// -----------------------------------------------------------------------------
// A fake OVHcloud AI Endpoints API on 127.0.0.1, for the tests: real HTTP, no
// network.
//
// Every request is recorded (`requests`); the answer of each route comes from
// a queue of handlers (`reply(route, handler)`), or a default one. A handler
// returns `{ status, body, headers }`. The fixtures were captured from the
// real API on 2026-11-25 (without a key, or with a made-up one): the catalog
// entries, a completion of GPT-OSS 120B with its `reasoning` field, the 403 of
// a wrong key, the 429 and its headers. Only the key is made up.
//
// `node --test` also runs this file: nothing starts on import.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';

export const API_KEY =
  'eyJhbGciOiJFZERTQSIsImtpZCI6InRlc3QifQ.eyJ0b2tlbiI6InRlc3QwMTIzIn0.c2lnbmF0dXJlMDEyMzQ1Njc4OQ';

/** The rate limit headers of an answer with a key (400 a minute, docs). */
export const LIMIT_HEADERS = {
  'ratelimit-limit': '400',
  'ratelimit-remaining': '397',
  'ratelimit-reset': '42',
};

/** The body of a wrong key (captured, the link shortened). */
export const FORBIDDEN_BODY = {
  message:
    'Forbidden: authentication failed.  Please generate a new one at https://kepler.ai.cloud.ovh.net/v1/oauth/ovh/authorize?iam_action=publicCloudProject:ai:endpoints/call',
};

/** The body of a request over the limit (captured). */
export const RATE_LIMIT_BODY = {
  message: 'API rate limit exceeded',
  request_id: 'eec5876ebad9a946f167b443fcf18c0d',
};

/**
 * @description A chat completion as AI Endpoints returns it (shape captured
 * from GPT-OSS 120B: `reasoning` next to `content`, usage with the reasoning
 * tokens).
 * @param {object} [message] - The assistant message.
 * @param {object} [extra] - Other fields (finish_reason, usage, model).
 * @returns {object} The body.
 */
export function completion(message = { role: 'assistant', content: 'Bonjour !' }, extra = {}) {
  return {
    id: 'chatcmpl-b245166f2f4aca5f',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', reasoning: 'The user greets: answer briefly.', ...message },
        finish_reason: extra.finish_reason ?? 'stop',
      },
    ],
    created: 1795599101,
    model: extra.model ?? 'gpt-oss-120b',
    object: 'chat.completion',
    usage: extra.usage ?? {
      prompt_tokens: 1800,
      completion_tokens: 60,
      total_tokens: 1860,
      prompt_tokens_details: { cached_tokens: 1000 },
      completion_tokens_details: { reasoning_tokens: 22 },
    },
  };
}

/** A few entries of GET /models, as captured (prices in USD per token). */
const price = (prompt, completion, cached = '0') => ({
  currency_unit: 'USD',
  completion,
  image: '0',
  prompt,
  request: '0',
  input_cache_reads: cached,
  input_cache_writes: '0',
});
export const MODELS = [
  {
    id: 'gpt-oss-120b',
    created: 1754992184,
    object: 'model',
    owned_by: 'OpenAI',
    pricing: price('0.00000009', '0.00000047'),
    context_length: 131072,
    max_completion_tokens: 131072,
  },
  {
    id: 'gpt-oss-20b',
    created: 1754992184,
    object: 'model',
    owned_by: 'OpenAI',
    pricing: price('0.00000005', '0.00000018'),
    context_length: 131072,
    max_completion_tokens: 65536,
  },
  {
    id: 'Mistral-Small-3.2-24B-Instruct-2506',
    created: 1754992184,
    object: 'model',
    owned_by: 'mistralai',
    pricing: price('0.0000001', '0.00000031'),
    context_length: 131072,
    max_completion_tokens: 131072,
  },
  {
    id: 'Qwen3.5-397B-A17B',
    created: 1754992184,
    object: 'model',
    owned_by: 'Qwen',
    pricing: price('0.00000071', '0.00000425'),
    context_length: 262144,
    max_completion_tokens: 262144,
  },
  {
    id: 'qwen3.6-35b-a3b',
    created: 1754992184,
    object: 'model',
    owned_by: 'Qwen',
    pricing: price('0.0000002', '0.00000133'),
    context_length: 262144,
    max_completion_tokens: 65536,
  },
  {
    id: 'Meta-Llama-3_3-70B-Instruct',
    created: 1754992184,
    object: 'model',
    owned_by: 'meta-llama',
    pricing: price('0.00000074', '0.00000074'),
    context_length: 131072,
    max_completion_tokens: 8192,
  },
  {
    id: 'whisper-large-v3-turbo',
    created: 1754992184,
    object: 'model',
    owned_by: 'OpenAi',
    pricing: price('0', '0'),
    context_length: 0,
    max_completion_tokens: 0,
  },
];

/**
 * @description Start the fake API.
 * @returns {Promise<object>} `{ url, requests, reply, close }`.
 */
export async function startFakeOvh() {
  const requests = [];
  const queues = new Map();
  const defaults = {
    'POST /v1/chat/completions': () => ({
      status: 200,
      body: completion(),
      headers: LIMIT_HEADERS,
    }),
    'GET /v1/models': () => ({ status: 200, body: { object: 'list', data: MODELS } }),
  };

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const path = decodeURIComponent(req.url);
      const route = `${req.method} ${path.split('?')[0]}`;
      const request = {
        route,
        path,
        headers: req.headers,
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      };
      requests.push(request);
      let answer;
      if (request.authorization !== `Bearer ${API_KEY}`) {
        answer = { status: 403, body: FORBIDDEN_BODY };
      } else {
        const queue = queues.get(route);
        const handler = queue?.length ? queue.shift() : defaults[route];
        answer = handler
          ? handler(request)
          : { status: 404, body: { message: 'no Route matched' } };
      }
      res.writeHead(answer.status, {
        'Content-Type': 'application/json',
        ...(answer.headers ?? {}),
      });
      res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    /**
     * @description Queue the answer of the next request of a route.
     * @param {string} route - "POST /v1/chat/completions", "GET /v1/models".
     * @param {Function|object} handler - `(request) => answer`, or the answer.
     */
    reply(route, handler) {
      if (!queues.has(route)) {
        queues.set(route, []);
      }
      queues.get(route).push(typeof handler === 'function' ? handler : () => handler);
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
