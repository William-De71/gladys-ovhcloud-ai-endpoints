// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake AI Endpoints API of the tests (a real local HTTP server,
// with the catalog and its prices captured on 2026-11-25), on a made-up
// Thursday, 12 November 2026 at 18:00 in Paris, after two weeks of made-up
// use (seeded random numbers) and one request over the rate limit this
// morning.
// Never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { startFakeOvh, completion, API_KEY, LIMIT_HEADERS, RATE_LIMIT_BODY } = await load(
  'test/helpers/fake-ovh.js',
);

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['usage'];
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 12, 17, 0, 0);

// A small seeded generator (mulberry32): the same picture at every run.
function random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @description One language: the usage widget.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const next = random(20261101);
  const clock = { now: NOW - 14 * DAY };
  const api = await startFakeOvh();
  const dir = mkdtempSync(join(tmpdir(), 'ovh-illustration-'));
  const gladys = createFakeGladys({ config: { api_key: API_KEY } });
  const app = createApp(gladys, {
    baseUrl: api.url,
    sleep: async () => {},
    usageFile: join(dir, 'usage.json'),
    now: () => clock.now,
    timeZone: 'Europe/Paris',
  });
  await gladys.connect();
  await app.whenReady();
  const ask = async (purpose, promptTokens, completionTokens) => {
    const model = purpose === 'chat' ? 'gpt-oss-120b' : 'Mistral-Small-3.2-24B-Instruct-2506';
    api.reply('POST /v1/chat/completions', {
      status: 200,
      headers: LIMIT_HEADERS,
      body: completion(
        { content: 'OK' },
        {
          model,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            prompt_tokens_details: { cached_tokens: Math.floor(promptTokens * 0.8) },
          },
        },
      ),
    });
    await gladys.fake.aiChat({ messages: [{ role: 'user', content: 'x' }], purpose });
  };
  for (let day = 14; day >= 0; day -= 1) {
    const turns = day === 0 ? 7 : 4 + Math.floor(next() * 12);
    for (let turn = 0; turn < turns; turn += 1) {
      clock.now = NOW - day * DAY - (turns - turn) * HOUR + 2 * 60 * 1000;
      await ask('intent-classification', 600 + Math.floor(next() * 300), 8);
      await ask('chat', 3500 + Math.floor(next() * 3000), 150 + Math.floor(next() * 500));
    }
    if (day === 0) {
      clock.now = NOW - 8 * HOUR;
      api.reply('POST /v1/chat/completions', {
        status: 429,
        headers: { 'Retry-After': '40' },
        body: RATE_LIMIT_BODY,
      });
      await gladys.fake.aiChat({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' });
    }
  }
  clock.now = NOW - 3 * 60 * 1000;
  await ask('chat', 5600, 340);
  clock.now = NOW;
  const result = {};
  for (const key of WIDGET_KEYS) {
    result[key] = (await gladys.fake.widgetGet(key, { language })).data.content;
  }
  app.usage.stop();
  await gladys.fake.shutdown();
  await api.close();
  rmSync(dir, { recursive: true, force: true });
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
  }),
);
