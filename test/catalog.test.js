import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_TTL_MS, createCatalog, summarize } from '../src/catalog.js';
import { MODELS } from './helpers/fake-ovh.js';

test('a catalog entry keeps its limits, whether it can chat and its prices per million tokens', () => {
  assert.deepEqual(summarize(MODELS[0]), {
    id: 'gpt-oss-120b',
    chat: true,
    context: 131072,
    maxOutput: 131072,
    price: { input: 0.09, output: 0.47, cached: null },
  });
  const whisper = summarize(MODELS.find((model) => model.id === 'whisper-large-v3-turbo'));
  assert.equal(whisper.chat, false, 'a speech model announces no answer length');
  assert.deepEqual(summarize({ id: 'a' }), {
    id: 'a',
    chat: false,
    context: null,
    maxOutput: null,
    price: null,
  });
  assert.equal(
    summarize({ id: 'c', pricing: { prompt: '0.000001', input_cache_reads: '0.0000005' } }).price
      .cached,
    0.5,
    'a real cache price is kept',
  );
  assert.deepEqual(summarize({ id: 'b', pricing: { prompt: '0.000001' } }).price, {
    input: 1,
    output: 0,
    cached: null,
  });
});

test('the catalog is read once, again after 12 hours, and kept on failure', async () => {
  let now = 1_000_000;
  let calls = 0;
  let fail = false;
  const errors = [];
  const catalog = createCatalog({
    fetchModels: async () => {
      calls += 1;
      if (fail) {
        throw new Error('down');
      }
      return MODELS;
    },
    now: () => now,
    onError: (err) => errors.push(err.message),
  });
  assert.equal(catalog.loaded(), false);
  assert.equal(catalog.name('gpt-oss-20b'), 'GPT-OSS 20B');
  assert.equal(catalog.price('gpt-oss-20b'), null, 'no price before the list');
  await catalog.ensure();
  await catalog.ensure();
  assert.equal(calls, 1);
  assert.equal(catalog.lookup('qwen3.6-35b-a3b').maxOutput, 65536);
  assert.deepEqual(catalog.price('Qwen3.5-397B-A17B'), { input: 0.71, output: 4.25, cached: null });
  assert.equal(catalog.lookup('nope'), undefined);
  now += CATALOG_TTL_MS + 1;
  fail = true;
  await catalog.ensure();
  assert.equal(calls, 2);
  assert.deepEqual(errors, ['down']);
  assert.ok(catalog.lookup('gpt-oss-120b'), 'the old list stays');
  await catalog.ensure();
  assert.equal(calls, 2, 'no new try within 10 minutes of a failure');
  assert.equal(catalog.name(null), '–');
  assert.equal(catalog.name('Meta-Llama-3_3-70B-Instruct'), 'Meta-Llama-3_3-70B-Instruct');
});

test('a list read by the key check is kept; an empty one is ignored', () => {
  const catalog = createCatalog({ fetchModels: async () => [] });
  catalog.accept([]);
  assert.equal(catalog.loaded(), false);
  catalog.accept(MODELS);
  assert.equal(catalog.loaded(), true);
});
