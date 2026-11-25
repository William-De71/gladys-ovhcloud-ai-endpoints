import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MODELS,
  DEFAULT_CONFIG,
  effortFor,
  IMAGE_MODEL,
  MODELS,
  normalizeConfig,
  outputBudget,
  presetName,
  resolveModel,
  ROUTER_MODELS,
} from '../src/config.js';

test('defaults fill an empty or broken configuration', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  const config = normalizeConfig({
    api_key: '  eyJabc  ',
    model: 'gpt-5',
    fast_model: 'custom',
    custom_model: 'bad id with spaces',
    reasoning: 'max',
    max_tokens: '999999',
  });
  assert.equal(config.api_key, 'eyJabc');
  assert.equal(config.model, 'gpt-oss-120b', 'an unknown model falls back');
  assert.equal(config.fast_model, 'custom');
  assert.equal(config.custom_model, '', 'an id that cannot be a model id is ignored');
  assert.equal(config.reasoning, 'low');
  assert.equal(config.max_tokens, 32000);
  assert.equal(normalizeConfig({ max_tokens: 'x' }).max_tokens, 8192);
  assert.equal(normalizeConfig({ max_tokens: 10 }).max_tokens, 1024);
  assert.equal(Object.hasOwn(normalizeConfig({ service_tier: 'flex' }), 'service_tier'), false);
});

test('each select keeps only its values, every preset is described', () => {
  assert.equal(normalizeConfig({ model: 'Qwen3.5-397B-A17B' }).model, 'Qwen3.5-397B-A17B');
  assert.equal(normalizeConfig({ fast_model: 'gpt-oss-120b' }).fast_model, 'gpt-oss-120b');
  assert.equal(
    normalizeConfig({ fast_model: 'Qwen3.5-397B-A17B' }).fast_model,
    'Mistral-Small-3.2-24B-Instruct-2506',
    'the largest model is not offered to the router',
  );
  for (const id of [...CHAT_MODELS, ...ROUTER_MODELS]) {
    assert.ok(MODELS[id], id);
  }
  assert.equal(MODELS[IMAGE_MODEL].images, true);
  assert.ok(CHAT_MODELS.includes(IMAGE_MODEL));
});

test('a select set to "custom" calls the custom id, null when it is empty', () => {
  for (const id of ['Meta-Llama-3_3-70B-Instruct', 'DeepSeek-V4.1-Flash-1017', 'gemma-4-26b-a4b']) {
    const config = normalizeConfig({ model: 'custom', custom_model: ` ${id} ` });
    assert.equal(resolveModel(config, 'model'), id);
    assert.equal(resolveModel(config, 'fast_model'), 'Mistral-Small-3.2-24B-Instruct-2506');
  }
  assert.equal(resolveModel(normalizeConfig({ model: 'custom' }), 'model'), null);
  assert.equal(presetName('Qwen3.5-397B-A17B'), 'Qwen 3.5 397B');
  assert.equal(presetName('x-y'), 'x-y');
});

test('the effort is the closest level the model accepts, nothing for a model that does not reason', () => {
  assert.equal(effortFor('gpt-oss-120b', 'none'), 'low');
  assert.equal(effortFor('gpt-oss-120b', 'medium'), 'medium');
  assert.equal(effortFor('qwen3.6-35b-a3b', 'none'), 'none');
  assert.equal(effortFor('Mistral-Small-3.2-24B-Instruct-2506', 'high'), undefined);
  assert.equal(effortFor('Mistral-Small-3.2-24B-Instruct-2506', 'none'), undefined);
  assert.equal(effortFor('x-y', 'none'), undefined);
  assert.equal(effortFor('x-y', 'high'), 'high');
});

test('the output budget follows the configuration, the caller, the model and the catalog', () => {
  assert.equal(outputBudget('gpt-oss-120b', 8192), 8192);
  assert.equal(outputBudget('gpt-oss-120b', 4096, 9000), 9000);
  assert.equal(outputBudget('gpt-oss-120b', 4096, 99999), 32000);
  assert.equal(outputBudget('x-y', 2048, 'x'), 2048);
  assert.equal(outputBudget('Meta-Llama-3_3-70B-Instruct', 16000, 0, 8192), 8192);
  assert.equal(outputBudget('x-y', 16000, 0, null), 16000);
});
