import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOvhClient,
  ERROR_KINDS,
  errorMessageOf,
  kindOf,
  maskKeys,
  OvhError,
  parseRetryAfter,
  readLimits,
} from '../src/ovh-api.js';
import { API_KEY, MODELS, RATE_LIMIT_BODY, startFakeOvh } from './helpers/fake-ovh.js';

const CHAT = 'POST /v1/chat/completions';

const client = (api, options = {}) => {
  const waits = [];
  const instance = createOvhClient({
    getApiKey: () => options.key ?? API_KEY,
    baseUrl: api.url,
    sleep: async (ms) => {
      waits.push(ms);
    },
    now: () => 1_000_000,
    ...options,
  });
  return { instance, waits };
};

test('sends the key as a Bearer token, returns the JSON body and keeps the rate limit per model', async (t) => {
  const api = await startFakeOvh();
  t.after(api.close);
  const { instance } = client(api);
  const body = await instance.chat({
    model: 'gpt-oss-20b',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(body.choices[0].message.content, 'Bonjour !');
  const sent = api.requests[0];
  assert.equal(sent.authorization, `Bearer ${API_KEY}`);
  assert.equal(sent.body.model, 'gpt-oss-20b');
  assert.deepEqual(instance.limits('gpt-oss-20b'), {
    at: 1_000_000,
    limit: 400,
    remaining: 397,
    resetAt: 1_000_000 + 42_000,
  });
  assert.equal(instance.limits('gpt-oss-120b'), null);
  assert.deepEqual(await instance.models(), MODELS);
  assert.deepEqual(
    api.requests.map((request) => request.route),
    [CHAT, 'GET /v1/models'],
  );
});

test('no key: fails before any request (the API allows one request a year without)', async (t) => {
  const api = await startFakeOvh();
  t.after(api.close);
  const { instance } = client(api, { key: '' });
  await assert.rejects(
    instance.chat({}),
    (err) => err instanceof OvhError && err.kind === ERROR_KINDS.AUTH,
  );
  assert.equal(api.requests.length, 0);
});

test('HTTP failures become error kinds, the key never in the message', async (t) => {
  const api = await startFakeOvh();
  t.after(api.close);
  const wrong = 'eyJhbGciOiJub25lIn0.eyJ3cm9uZyI6dHJ1ZX0wMTIz.d3Jvbmdfc2lnbmF0dXJl';
  const { instance } = client(api, { key: wrong });
  // The real answer to a wrong key is a 403, also on GET /models.
  await assert.rejects(
    instance.chat({}),
    (err) =>
      err.kind === ERROR_KINDS.AUTH &&
      err.status === 403 &&
      /HTTP 403: Forbidden: authentication failed\.$/.test(err.message) &&
      !err.message.includes(wrong) &&
      !err.message.includes('kepler'),
  );
  await assert.rejects(instance.models(), (err) => err.kind === ERROR_KINDS.AUTH);
  const good = client(api).instance;
  api.reply(CHAT, {
    status: 403,
    body: { message: "Resource tag 'discovery' is forbidden" },
  });
  await assert.rejects(good.chat({}), (err) => err.kind === ERROR_KINDS.PROJECT);
  api.reply(CHAT, { status: 404, body: { message: 'no Route matched with those values' } });
  await assert.rejects(good.chat({}), (err) => err.kind === ERROR_KINDS.MODEL);
  api.reply(CHAT, { status: 413, body: { message: 'Request size limit exceeded' } });
  await assert.rejects(good.chat({}), (err) => err.kind === ERROR_KINDS.TOO_LARGE);
  assert.equal(api.requests.length, 5, 'a request too large is never retried');
  api.reply(CHAT, {
    status: 400,
    body: {
      message:
        'feature \'extra arguments: {"chat_template_kwargs":{"enable_thinking":false}}\' is not currently supported',
    },
  });
  await assert.rejects(
    good.chat({}),
    (err) => err.kind === ERROR_KINDS.REQUEST && /not currently supported/.test(err.message),
  );
  api.reply(CHAT, { status: 200, body: 'not json' });
  // Not JSON: a server fault, retried like a 5xx (here without retry).
  await assert.rejects(good.chat({}, { retries: false }), (err) => err.kind === ERROR_KINDS.SERVER);
});

test('429 and 5xx are retried with Retry-After or backoff, then give up', async (t) => {
  const api = await startFakeOvh();
  t.after(api.close);
  const { instance, waits } = client(api, { now: Date.now });
  api.reply(CHAT, { status: 429, body: RATE_LIMIT_BODY, headers: { 'Retry-After': '2' } });
  api.reply(CHAT, { status: 502, body: { message: 'An invalid response was received' } });
  const body = await instance.chat({});
  assert.equal(body.choices[0].message.content, 'Bonjour !');
  assert.deepEqual(waits, [2000, 2000]);
  for (let i = 0; i < 3; i += 1) {
    api.reply(CHAT, { status: 503, body: { message: 'busy' } });
  }
  await assert.rejects(instance.chat({}), (err) => err.kind === ERROR_KINDS.SERVER);
  assert.equal(api.requests.length, 6);
  // The key check never retries.
  api.reply('GET /v1/models', { status: 503, body: { message: 'busy' } });
  await assert.rejects(instance.models(), (err) => err.kind === ERROR_KINDS.SERVER);
  assert.equal(api.requests.length, 7);
});

test('a wait that would not fit in the deadline fails at once with the real reason', async (t) => {
  const api = await startFakeOvh();
  t.after(api.close);
  const { instance, waits } = client(api, { now: Date.now });
  // The anonymous limit seen on 2026-11-25: one request a year.
  api.reply(CHAT, {
    status: 429,
    body: RATE_LIMIT_BODY,
    headers: { 'Retry-After': '3162508', 'x-ratelimit-limit-year': '1' },
  });
  await assert.rejects(
    instance.chat({}, { timeoutMs: 18_000 }),
    (err) => err.kind === ERROR_KINDS.RATE_LIMIT && /API rate limit exceeded/.test(err.message),
  );
  assert.deepEqual(waits, []);
});

test('an unreachable API and a timeout are named as such', async () => {
  const unreachable = createOvhClient({
    getApiKey: () => 'k',
    baseUrl: 'http://127.0.0.1:9/v1',
    sleep: async () => {},
  });
  await assert.rejects(
    unreachable.chat({}, { retries: false }),
    (err) => err.kind === ERROR_KINDS.UNREACHABLE,
  );
  const slow = createOvhClient({
    getApiKey: () => 'k',
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  });
  // AbortSignal.timeout does not keep the process alive: this timer does.
  const hold = setTimeout(() => {}, 1000);
  await assert.rejects(
    slow.chat({}, { timeoutMs: 50, retries: false }),
    (err) => err.kind === ERROR_KINDS.TIMEOUT,
  );
  clearTimeout(hold);
});

test('kinds, error bodies, keys, limits and Retry-After are read safely', () => {
  assert.equal(kindOf(401), 'auth');
  assert.equal(kindOf(403, null, 'Forbidden: authentication failed.'), 'auth');
  assert.equal(kindOf(403, null, 'something else'), 'auth');
  assert.equal(kindOf(403, null, "Resource tag 'discovery' is forbidden"), 'project');
  assert.equal(kindOf(404), 'model');
  assert.equal(kindOf(400, null, 'The model `nope` does not exist.'), 'model');
  assert.equal(kindOf(408), 'timeout');
  assert.equal(kindOf(413), 'too_large');
  assert.equal(kindOf(429), 'rate_limit');
  assert.equal(kindOf(502), 'server');
  assert.equal(kindOf(400), 'request');
  assert.equal(kindOf(422), 'request');
  assert.equal(maskKeys(`key ${API_KEY} refused`), 'key *** refused');
  assert.equal(
    errorMessageOf({ error: { message: 'Bearer abc.def is invalid' } }),
    'Bearer *** is invalid',
  );
  assert.equal(errorMessageOf({ message: 'API rate limit exceeded' }), 'API rate limit exceeded');
  assert.equal(errorMessageOf({ detail: 'Not Found' }), 'Not Found');
  assert.equal(errorMessageOf('x'.repeat(500)).length, 300);
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4000), 6000);
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(readLimits(new Headers({}), 0), null);
  assert.deepEqual(readLimits(new Headers({ 'ratelimit-remaining': '0' }), 5), {
    at: 5,
    limit: null,
    remaining: 0,
    resetAt: null,
  });
});
