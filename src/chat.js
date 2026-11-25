// -----------------------------------------------------------------------------
// The AI provider: one OpenAI chat completion in, one out, answered by a model
// of OVHcloud AI Endpoints.
//
// The whole agentic loop (prompts, tools, history) stays in the Gladys core:
// this handler picks the model, prepares the request (convert.js), calls
// /chat/completions and bounds the answer. It runs no tool.
//
// What each `purpose` gets:
//   - `intent-classification` (the router, before every chat turn): the
//     router model with the least reasoning it accepts, under 18 s (the core
//     waits 20 s);
//   - `chat`, `weekly-digest` and anything else: the chat model at the
//     reasoning level of the configuration, under 110 s (the core waits 120 s).
//
// AI Endpoints documents no reasoning parameter: `reasoning_effort` is sent to
// the models that reason (accepted by GPT-OSS and Qwen, checked 2026-11-25)
// and dropped for good from a model that refuses it.
// -----------------------------------------------------------------------------

import { AI_CHAT_PURPOSES, createLogger } from '@gladysassistant/integration-sdk';
import {
  effortFor,
  IMAGE_MODEL,
  MODELS,
  outputBudget,
  presetName,
  resolveModel,
} from './config.js';
import {
  hasImages,
  toOvhMessages,
  toOvhToolChoice,
  toOvhTools,
  toOpenAiCompletion,
} from './convert.js';
import { ERROR_KINDS, OvhError } from './ovh-api.js';
import { costOf } from './usage.js';

const logger = createLogger({ name: 'chat' });

export const CHAT_TIMEOUT_MS = 110_000;
export const ROUTER_TIMEOUT_MS = 18_000;

/**
 * @description The use counted for a purpose.
 * @param {string} purpose - The `purpose` of the request.
 * @returns {string} `router`, `digest` or `chat`.
 */
export function useOf(purpose) {
  if (purpose === AI_CHAT_PURPOSES.INTENT_CLASSIFICATION) {
    return 'router';
  }
  if (purpose === AI_CHAT_PURPOSES.WEEKLY_DIGEST) {
    return 'digest';
  }
  return 'chat';
}

/**
 * @description Build the AI Endpoints request of a core request.
 * @param {object} request - `{ messages, tools?, tool_choice?, max_tokens?, purpose }`.
 * @param {object} config - The normalized config.
 * @param {object} [options] - Options.
 * @param {Set<string>} [options.noReasoning] - Models that refused `reasoning_effort`.
 * @param {object} [options.catalog] - The catalog (largest answer of a model typed by hand).
 * @returns {object} The body.
 */
export function buildBody(request, config, { noReasoning = new Set(), catalog } = {}) {
  const router = request?.purpose === AI_CHAT_PURPOSES.INTENT_CLASSIFICATION;
  const model = resolveModel(config, router ? 'fast_model' : 'model');
  if (!model) {
    throw new OvhError(
      ERROR_KINDS.MODEL,
      'The configuration chooses another model but its id is empty',
    );
  }
  if (MODELS[model]?.images === false && hasImages(request?.messages)) {
    throw new OvhError(
      ERROR_KINDS.REQUEST,
      `${MODELS[model].name} cannot read images: choose ${presetName(IMAGE_MODEL)} as the chat model`,
    );
  }
  const body = {
    model,
    messages: toOvhMessages(request?.messages),
    // The caller's `max_tokens` is sized for an answer without reasoning. The
    // guides of AI Endpoints write `max_tokens`; it counts the reasoning.
    max_tokens: outputBudget(
      model,
      config.max_tokens,
      request?.max_tokens,
      catalog?.lookup(model)?.maxOutput,
    ),
  };
  const tools = toOvhTools(request?.tools);
  if (tools.length > 0) {
    body.tools = tools;
    const choice = toOvhToolChoice(request?.tool_choice);
    if (choice !== undefined) {
      body.tool_choice = choice;
    }
  }
  if (!noReasoning.has(model)) {
    const effort = effortFor(model, router ? 'none' : config.reasoning);
    if (effort !== undefined) {
      body.reasoning_effort = effort;
    }
  }
  return body;
}

/**
 * @description Whether a refusal is about the reasoning parameters.
 * @param {unknown} err - The error.
 * @returns {boolean} True for a 400 or 422 that names them ("feature '…' is
 * not currently supported").
 */
function refusedReasoning(err) {
  return (
    err instanceof OvhError &&
    err.kind === ERROR_KINDS.REQUEST &&
    (err.status === 400 || err.status === 422) &&
    /reasoning|effort/i.test(err.message)
  );
}

/**
 * @description Create the `onAiChat` handler.
 * @param {object} options - Options.
 * @param {object} options.client - The AI Endpoints client.
 * @param {() => object} options.getConfig - The normalized config.
 * @param {object} [options.catalog] - The model catalog.
 * @param {object} [options.usage] - The usage store (usage.js).
 * @param {(err: OvhError, context: object) => void} [options.onFailure] - Failure hook.
 * @param {() => void} [options.onSuccess] - Success hook.
 * @param {() => number} [options.now] - Clock.
 * @returns {(request: object) => Promise<object>} The handler.
 */
export function createChatHandler({
  client,
  getConfig,
  catalog,
  usage,
  onFailure = () => {},
  onSuccess = () => {},
  now = Date.now,
}) {
  // Models that refused `reasoning_effort`: never sent to them again until the
  // integration restarts.
  const noReasoning = new Set();
  const name = (id) => catalog?.name(id) ?? id;

  return async function onAiChat(request) {
    const config = getConfig();
    const use = useOf(request?.purpose);
    const router = use === 'router';
    const timeoutMs = router ? ROUTER_TIMEOUT_MS : CHAT_TIMEOUT_MS;
    const started = now();
    const left = () => timeoutMs - (now() - started);
    let body;
    try {
      body = buildBody(request, config, { noReasoning, catalog });
      let response;
      for (;;) {
        try {
          response = await client.chat(body, { timeoutMs: Math.max(1000, left()) });
          break;
        } catch (err) {
          if (body.reasoning_effort && refusedReasoning(err)) {
            logger.warn(
              `${body.model} refused reasoning_effort ${body.reasoning_effort}: sent without it from now on`,
            );
            noReasoning.add(body.model);
            const { reasoning_effort: _effort, ...rest } = body;
            body = rest;
            continue;
          }
          throw err;
        }
      }
      const completion = toOpenAiCompletion(response);
      const message = completion.choices[0].message;
      const finish = completion.choices[0].finish_reason;
      const ms = now() - started;
      if (!message.content && !message.tool_calls) {
        if (finish === 'length') {
          throw new OvhError(
            ERROR_KINDS.REQUEST,
            `The answer was cut at max_tokens (${body.max_tokens}) before any text: raise it in the configuration`,
          );
        }
        if (finish === 'content_filter') {
          throw new OvhError(ERROR_KINDS.REQUEST, 'The model filtered the answer');
        }
      }
      if (finish === 'length') {
        logger.warn(
          `The answer hit max_tokens (${body.max_tokens}): raise it in the configuration`,
        );
      }
      const tokens = response?.usage ?? {};
      const cached = Number(tokens.prompt_tokens_details?.cached_tokens) || 0;
      logger.info(
        `${request?.purpose ?? 'chat'}: ${name(body.model)} answered in ${(ms / 1000).toFixed(1)} s` +
          ` (${tokens.prompt_tokens ?? '?'} in${cached ? `, ${cached} cached` : ''}, ${tokens.completion_tokens ?? '?'} out` +
          `${message.tool_calls ? `, ${message.tool_calls.length} tool call(s)` : ''})`,
      );
      usage?.recordSuccess({
        use,
        model: body.model,
        usage: response?.usage,
        ms,
        cost: costOf(response?.usage, catalog?.price(body.model) ?? null),
      });
      onSuccess();
      return completion;
    } catch (err) {
      const error =
        err instanceof OvhError
          ? err
          : new OvhError(ERROR_KINDS.SERVER, err?.message ?? String(err));
      logger.warn(`${request?.purpose ?? 'chat'} failed (${error.kind}): ${error.message}`);
      usage?.recordError({ use, model: body?.model, kind: error.kind, message: error.message });
      onFailure(error, { use, model: body?.model });
      throw error;
    }
  };
}
