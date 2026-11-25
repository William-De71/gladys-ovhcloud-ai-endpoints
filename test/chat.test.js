import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_CHAT_PURPOSES, validateAiCompletion } from '@gladysassistant/integration-sdk';
import { buildBody, createChatHandler, useOf } from '../src/chat.js';
import { normalizeConfig } from '../src/config.js';
import { createCatalog } from '../src/catalog.js';
import { createOvhClient, ERROR_KINDS } from '../src/ovh-api.js';
import { API_KEY, completion, startFakeOvh } from './helpers/fake-ovh.js';

const CHAT = 'POST /v1/chat/completions';
const TOOLS = [
  {
    type: 'function',
    function: { name: 'device_set_value', parameters: { type: 'object', properties: {} } },
  },
];
const IMAGE = {
  role: 'user',
  content: [
    { type: 'text', text: 'Que vois-tu ?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
  ],
};

const setup = async (t, raw = {}) => {
  const api = await startFakeOvh();
  t.after(api.close);
  const config = normalizeConfig({ api_key: API_KEY, ...raw });
  const client = createOvhClient({
    getApiKey: () => config.api_key,
    baseUrl: api.url,
    sleep: async () => {},
  });
  const catalog = createCatalog({ fetchModels: () => client.models() });
  const recorded = { success: [], error: [], failures: [], successes: 0 };
  const usage = {
    recordSuccess: (entry) => recorded.success.push(entry),
    recordError: (entry) => recorded.error.push(entry),
  };
  const handler = createChatHandler({
    client,
    getConfig: () => config,
    catalog,
    usage,
    onFailure: (err, context) => recorded.failures.push({ kind: err.kind, ...context }),
    onSuccess: () => {
      recorded.successes += 1;
    },
  });
  const chats = () => api.requests.filter((request) => request.route === CHAT);
  return { api, handler, recorded, config, catalog, chats };
};

test('the router gets the fast model without reasoning; the chat the main model with tools', async (t) => {
  const { handler, recorded, chats, catalog } = await setup(t);
  await catalog.ensure();
  await handler({
    messages: [
      { role: 'system', content: 'Classify' },
      { role: 'user', content: 'Allume' },
    ],
    purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION,
  });
  const router = chats()[0].body;
  assert.equal(router.model, 'Mistral-Small-3.2-24B-Instruct-2506');
  assert.equal(router.reasoning_effort, undefined, 'Mistral Small does not reason');
  assert.equal(router.tools, undefined);
  assert.equal(router.user, undefined);
  assert.equal(router.service_tier, undefined);

  const answer = await handler({
    messages: [{ role: 'user', content: 'Allume le salon' }],
    tools: TOOLS,
    tool_choice: 'required',
    max_tokens: 2000,
    purpose: AI_CHAT_PURPOSES.CHAT,
    categories: ['devices'],
  });
  const chat = chats()[1].body;
  assert.equal(chat.model, 'gpt-oss-120b');
  assert.equal(chat.reasoning_effort, 'low');
  assert.equal(chat.include_reasoning, undefined, 'not an AI Endpoints parameter');
  assert.equal(chat.tool_choice, 'required');
  assert.equal(chat.max_tokens, 8192, 'the configured budget when the caller asks less');
  assert.equal(chat.max_completion_tokens, undefined);
  assert.equal(chat.purpose, undefined);
  assert.equal(chat.categories, undefined);
  assert.deepEqual(validateAiCompletion(answer), []);
  assert.equal(answer.choices[0].message.reasoning, undefined, 'the reasoning stays here');
  assert.deepEqual(
    recorded.success.map((entry) => entry.use),
    ['router', 'chat'],
  );
  assert.equal(recorded.success[1].usage.prompt_tokens_details.cached_tokens, 1000);
  // The catalog gives no cache price: 1,800 tokens at 0.09 $/M, 60 written at 0.47 $/M.
  assert.ok(Math.abs(recorded.success[1].cost - (1800 * 0.09 + 60 * 0.47) / 1e6) < 1e-12);
  assert.equal(recorded.successes, 2);
});

test('without the catalog the cost is unknown, never made up', async (t) => {
  const { handler, recorded } = await setup(t);
  await handler({ messages: [{ role: 'user', content: 'Bonjour' }], purpose: 'chat' });
  assert.equal(recorded.success[0].cost, null);
});

test('the reasoning level follows what each model accepts', () => {
  const body = (raw, purpose = 'chat') =>
    buildBody({ messages: [], purpose }, normalizeConfig({ api_key: 'k', ...raw }));
  // Qwen can turn reasoning off; GPT-OSS gets its lowest level.
  assert.equal(
    body({ fast_model: 'qwen3.6-35b-a3b' }, AI_CHAT_PURPOSES.INTENT_CLASSIFICATION)
      .reasoning_effort,
    'none',
  );
  assert.equal(
    body({ fast_model: 'gpt-oss-20b' }, AI_CHAT_PURPOSES.INTENT_CLASSIFICATION).reasoning_effort,
    'low',
  );
  assert.equal(body({ reasoning: 'none' }).reasoning_effort, 'low');
  assert.equal(body({ reasoning: 'high' }).reasoning_effort, 'high');
  assert.equal(
    body({ model: 'Mistral-Small-3.2-24B-Instruct-2506', reasoning: 'high' }).reasoning_effort,
    undefined,
  );
  // An unknown model gets nothing for "none", the level as asked otherwise.
  const custom = { model: 'custom', custom_model: 'Meta-Llama-3_3-70B-Instruct' };
  assert.equal(body({ ...custom, reasoning: 'none' }).reasoning_effort, undefined);
  assert.equal(body({ ...custom, reasoning: 'medium' }).reasoning_effort, 'medium');
});

test('the output budget is bounded by the model, or by the catalog for a model typed by hand', async () => {
  const catalog = createCatalog({
    fetchModels: async () => (await import('./helpers/fake-ovh.js')).MODELS,
  });
  await catalog.ensure();
  const body = buildBody(
    { messages: [], max_tokens: 30000, purpose: 'chat' },
    normalizeConfig({ api_key: 'k', model: 'custom', custom_model: 'Meta-Llama-3_3-70B-Instruct' }),
    { catalog },
  );
  assert.equal(body.max_tokens, 8192);
  assert.equal(
    buildBody({ messages: [], max_tokens: 30000 }, normalizeConfig({ api_key: 'k' })).max_tokens,
    30000,
  );
});

test('the purposes are counted as router, digest or chat', () => {
  assert.equal(useOf(AI_CHAT_PURPOSES.INTENT_CLASSIFICATION), 'router');
  assert.equal(useOf(AI_CHAT_PURPOSES.WEEKLY_DIGEST), 'digest');
  assert.equal(useOf(AI_CHAT_PURPOSES.CHAT), 'chat');
  assert.equal(useOf(undefined), 'chat');
});

test('no tools: neither tools nor tool_choice is sent', () => {
  const body = buildBody(
    { messages: [], tools: [], tool_choice: 'auto' },
    normalizeConfig({ api_key: 'k' }),
  );
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
});

test('a model that refuses reasoning_effort is asked again without it, then never', async (t) => {
  const { api, handler, chats } = await setup(t, {
    model: 'custom',
    custom_model: 'Meta-Llama-3_3-70B-Instruct',
  });
  api.reply(CHAT, {
    status: 400,
    body: { message: "feature 'reasoning_effort' is not currently supported" },
  });
  const answer = await handler({
    messages: [{ role: 'user', content: 'Bonjour' }],
    purpose: 'chat',
  });
  assert.equal(answer.choices[0].message.content, 'Bonjour !');
  assert.equal(chats()[0].body.reasoning_effort, 'low');
  assert.equal(chats()[1].body.reasoning_effort, undefined);
  await handler({ messages: [{ role: 'user', content: 'Encore' }], purpose: 'chat' });
  assert.equal(chats()[2].body.reasoning_effort, undefined);
});

test('a tool call answer keeps its calls and loses the reasoning; another 400 goes to the core', async (t) => {
  const { api, handler, chats } = await setup(t);
  // The shape GPT-OSS 120B answered on 2026-11-25: empty content, reasoning, calls.
  api.reply(CHAT, {
    status: 200,
    body: completion(
      {
        content: '',
        reasoning: 'We need to call turn_on with room "kitchen".',
        tool_calls: [
          {
            id: 'chatcmpl-tool-86e74f8150c1254f',
            type: 'function',
            function: { name: 'device_set_value', arguments: '{"room": "kitchen"}' },
          },
        ],
      },
      { finish_reason: 'tool_calls' },
    ),
  });
  const answer = await handler({
    messages: [{ role: 'user', content: 'Allume' }],
    tools: TOOLS,
    purpose: 'chat',
  });
  assert.equal(answer.choices[0].finish_reason, 'tool_calls');
  assert.equal(answer.choices[0].message.content, null);
  assert.equal(answer.choices[0].message.reasoning, undefined);
  assert.equal(answer.choices[0].message.tool_calls[0].id, 'chatcmpl-tool-86e74f8150c1254f');
  assert.deepEqual(validateAiCompletion(answer), []);
  api.reply(CHAT, { status: 400, body: { message: 'Invalid tool definition' } });
  await assert.rejects(
    handler({ messages: [{ role: 'user', content: 'Allume' }], tools: TOOLS, purpose: 'chat' }),
    (err) => err.kind === ERROR_KINDS.REQUEST,
  );
  assert.equal(chats().length, 2, 'never asked again');
});

test('failures are thrown (the core names them), counted and reported', async (t) => {
  const { api, handler, recorded, chats } = await setup(t);
  api.reply(CHAT, {
    status: 403,
    body: { message: 'Forbidden: authentication failed.' },
  });
  await assert.rejects(
    handler({ messages: [], purpose: 'chat' }),
    (err) => err.kind === ERROR_KINDS.AUTH,
  );
  assert.deepEqual(recorded.failures, [{ kind: 'auth', use: 'chat', model: 'gpt-oss-120b' }]);
  assert.equal(recorded.error[0].kind, 'auth');

  // GPT-OSS reads no image: refused before any call.
  await assert.rejects(
    handler({ messages: [IMAGE], purpose: 'chat' }),
    /cannot read images: choose Qwen 3\.5 397B/,
  );
  assert.equal(chats().length, 1);
});

test('images go to Qwen 3.5, which reads them', async (t) => {
  const { handler, chats } = await setup(t, { model: 'Qwen3.5-397B-A17B' });
  await handler({ messages: [IMAGE], purpose: 'chat' });
  const sent = chats()[0].body.messages[0].content;
  assert.equal(sent[1].type, 'image_url');
});

test('an answer cut before any text fails clearly; a cut text is still returned', async (t) => {
  const { api, handler } = await setup(t);
  api.reply(CHAT, {
    status: 200,
    body: completion({ content: '' }, { finish_reason: 'length' }),
  });
  await assert.rejects(handler({ messages: [], purpose: 'chat' }), /cut at max_tokens/);
  api.reply(CHAT, {
    status: 200,
    body: completion({ content: 'Le début' }, { finish_reason: 'length' }),
  });
  const answer = await handler({ messages: [], purpose: 'chat' });
  assert.equal(answer.choices[0].message.content, 'Le début');
});

test('a custom model without id fails without calling AI Endpoints', async (t) => {
  const { api, handler } = await setup(t, { fast_model: 'custom' });
  await assert.rejects(
    handler({ messages: [], purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION }),
    (err) => err.kind === ERROR_KINDS.MODEL,
  );
  assert.equal(api.requests.length, 0);
});
