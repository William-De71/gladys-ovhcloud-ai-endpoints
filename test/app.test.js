// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`) and a fake AI Endpoints API
// (test/helpers/fake-ovh.js), a real HTTP server on 127.0.0.1. No test
// touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import {
  AI_CHAT_PURPOSES,
  validateAiCompletion,
  validateWidgetContent,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS, createApp } from '../src/app.js';
import { TRIGGERS } from '../src/events.js';
import { WIDGETS } from '../src/widgets.js';
import { API_KEY, startFakeOvh } from './helpers/fake-ovh.js';

const CHAT = 'POST /v1/chat/completions';
const DISCOVERY = { status: 403, body: { message: "Resource tag 'discovery' is forbidden" } };

const start = async (t, config = { api_key: API_KEY }) => {
  const api = await startFakeOvh();
  const dir = await mkdtemp(join(tmpdir(), 'ovh-app-'));
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    baseUrl: api.url,
    sleep: async () => {},
    usageFile: join(dir, 'usage.json'),
    timeZone: 'Europe/Paris',
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    app.usage.stop();
    await gladys.disconnect?.();
    await api.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { api, gladys, app };
};

test('connects: checks the key and the models without spending a token, status OK', async (t) => {
  const { api, gladys } = await start(t);
  assert.deepEqual(
    api.requests.map((r) => r.route),
    ['GET /v1/models'],
  );
  assert.equal(gladys.fake.connectionStatuses.at(-1).connected, true);
});

test('without a key: status explains it, nothing is called', async (t) => {
  const { api, gladys } = await start(t, {});
  assert.equal(api.requests.length, 0);
  const status = gladys.fake.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(JSON.stringify(status), /Public Cloud, AI Endpoints, API keys/);
});

test('answers the AI requests of the core with valid completions', async (t) => {
  const { api, gladys } = await start(t);
  const ack = await gladys.fake.aiChat({
    messages: [{ role: 'user', content: 'Bonjour' }],
    tools: [
      { type: 'function', function: { name: 'x', parameters: { type: 'object', properties: {} } } },
    ],
    tool_choice: 'auto',
    purpose: AI_CHAT_PURPOSES.CHAT,
  });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.deepEqual(validateAiCompletion(ack.data), []);
  assert.equal(ack.data.choices[0].message.content, 'Bonjour !');
  const body = api.requests.at(-1).body;
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.reasoning_effort, 'low');
});

test('a project without payment method: the ack fails, one error event, status explains, then recovery', async (t) => {
  const { api, gladys } = await start(t);
  for (let i = 0; i < 3; i += 1) {
    api.reply(CHAT, DISCOVERY);
  }
  for (let i = 0; i < 3; i += 1) {
    const ack = await gladys.fake.aiChat({
      messages: [{ role: 'user', content: 'x' }],
      purpose: 'chat',
    });
    assert.equal(ack.success, false);
  }
  assert.equal(api.requests.filter((r) => r.route === CHAT).length, 3, 'never retried');
  await tick();
  const errors = gladys.fake.sceneEvents.filter(
    (event) => (event.key ?? event.event_key) === TRIGGERS.ERROR,
  );
  assert.equal(errors.length, 1, JSON.stringify(gladys.fake.sceneEvents));
  assert.equal(JSON.stringify(errors[0]).includes('project'), true);
  const status = gladys.fake.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(JSON.stringify(status), /ajoutez un moyen de paiement au projet/);
  const ack = await gladys.fake.aiChat({
    messages: [{ role: 'user', content: 'x' }],
    purpose: 'chat',
  });
  assert.equal(ack.success, true);
  await tick();
  assert.ok(
    gladys.fake.sceneEvents.some((event) => (event.key ?? event.event_key) === TRIGGERS.RECOVERED),
  );
  assert.equal(gladys.fake.connectionStatuses.at(-1).connected, true);
});

test('the test button answers with each model, its time and the requests left this minute', async (t) => {
  const { gladys, api } = await start(t, { api_key: API_KEY, fast_model: 'qwen3.6-35b-a3b' });
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
  assert.equal(ack.success, true);
  const text = ack.data.message.fr;
  assert.match(
    text,
    /Discussion — GPT-OSS 120B a répondu en .* Il reste 397 requêtes sur 400 pour cette minute/,
  );
  assert.match(text, /Routeur — Qwen 3\.6 35B a répondu en/);
  const tests = api.requests.filter((r) => r.route === CHAT).map((r) => r.body);
  assert.deepEqual(
    tests.map((body) => [body.model, body.reasoning_effort, body.max_tokens]),
    [
      ['gpt-oss-120b', 'low', 1024],
      ['qwen3.6-35b-a3b', 'none', 1024],
    ],
  );
});

test('the widget counts what was asked, with the estimated cost, valid in every language', async (t) => {
  const { gladys } = await start(t);
  await gladys.fake.aiChat({
    messages: [{ role: 'user', content: 'x' }],
    purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION,
  });
  await gladys.fake.aiChat({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' });
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await gladys.fake.widgetGet(WIDGETS.USAGE, { language });
    assert.equal(ack.success, true);
    assert.deepEqual(validateWidgetContent(ack.data.content), [], language);
    const tiles = ack.data.content.components.filter((c) => c.type === 'value');
    assert.equal(tiles[0].value, 2);
    assert.equal(tiles.length, 5);
    // Two answers of 800 + 1,000 cached + 60 tokens, priced from the catalog
    // read at startup: well under a cent.
    assert.match(tiles[2].value, /^< /);
  }
});

test('a speech model typed by hand is refused at once', async (t) => {
  const { gladys } = await start(t);
  await gladys.fake.configUpdated({
    api_key: API_KEY,
    model: 'custom',
    custom_model: 'whisper-large-v3-turbo',
  });
  const status = gladys.fake.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(JSON.stringify(status), /n’est pas un modèle de langage/);
});

test('a new configuration is applied and checked at once', async (t) => {
  const { gladys, app } = await start(t);
  await gladys.fake.configUpdated({
    api_key: API_KEY,
    model: 'custom',
    custom_model: 'Llama-9-Unknown',
  });
  assert.equal(app.getConfig().model, 'custom');
  const status = gladys.fake.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(JSON.stringify(status), /Llama-9-Unknown/);
});

test('a key refused at startup shows on the status', async (t) => {
  const { gladys } = await start(t, { api_key: 'revoked' });
  const status = gladys.fake.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(JSON.stringify(status), /AI Endpoints a refusé la clé/);
  assert.doesNotMatch(JSON.stringify(status), /kepler/, 'the sign-in link of the 403 is dropped');
});
