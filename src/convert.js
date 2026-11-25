// -----------------------------------------------------------------------------
// OpenAI chat completions of the Gladys core <-> AI Endpoints chat completions.
//
// AI Endpoints speaks the same dialect as the core, so most of the request
// goes through as it is. What is handled here:
//
//   - calls and results stay paired. The core writes `unknown` /
//     `tool_call_unknown` when a call had no id, and a history may hold a call
//     without its result: such a call gets a stable made-up id, the results
//     take the open calls in order, a call left alone gets
//     {@link MISSING_OUTPUT} and a result whose call is unknown is dropped, so
//     the model always reads a consistent conversation.
//   - reasoning never goes back. AI Endpoints returns the reasoning of GPT-OSS
//     in a separate `message.reasoning` field (seen 2026-11-25; other servers
//     write `reasoning_content`): only `content` and `tool_calls` are kept, so
//     the core never stores it and the next turn never sends it back.
//   - the answer is bounded like the core bounds it (validateAiCompletion):
//     `content` a string or null, at most 20 tool calls, names
//     `^[a-zA-Z0-9_-]{1,64}$`, `arguments` a JSON string.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/** The bounds the core applies to a completion (validateAiCompletion). */
const MAX_TOOL_CALLS = 20;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ID = 128;
/** Ids the core writes when a tool call had none. */
const PLACEHOLDER_IDS = new Set(['unknown', 'tool_call_unknown']);
/** What a tool call without a result gets: a lone call confuses the model. */
export const MISSING_OUTPUT = '{"error":"no result"}';

/**
 * @description A short stable hash.
 * @param {string} value - The value.
 * @returns {string} 24 hex characters.
 */
function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

/**
 * @description The text of a content (string or list of parts).
 * @param {unknown} content - An OpenAI content.
 * @returns {string} The text parts joined.
 */
export function textOf(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part?.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('');
}

/**
 * @description Whether a request carries an image.
 * @param {Array<object>} messages - OpenAI messages.
 * @returns {boolean} True when a user message has an image part.
 */
export function hasImages(messages) {
  return (messages ?? []).some(
    (message) =>
      Array.isArray(message?.content) && message.content.some((part) => part?.type === 'image_url'),
  );
}

/**
 * @description The content of a user message: a string, or text and image
 * parts when it carries an image.
 * @param {unknown} content - The OpenAI content.
 * @returns {string|Array<object>} The content.
 */
function userContent(content) {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }
  const parts = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) {
        parts.push({ type: 'text', text: part });
      }
    } else if (part?.type === 'text' && typeof part.text === 'string') {
      if (part.text) {
        parts.push({ type: 'text', text: part.text });
      }
    } else if (part?.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (typeof url === 'string' && url) {
        const image = { url };
        if (['low', 'high', 'auto'].includes(part.image_url?.detail)) {
          image.detail = part.image_url.detail;
        }
        parts.push({ type: 'image_url', image_url: image });
      }
    }
  }
  if (parts.length === 0) {
    return '';
  }
  return parts.every((part) => part.type === 'text')
    ? parts.map((part) => part.text).join('\n')
    : parts;
}

/**
 * @description The arguments of a tool call as a JSON string.
 * @param {unknown} value - A string or an object.
 * @returns {string} JSON.
 */
function argumentsString(value) {
  if (typeof value === 'string') {
    return value.trim() ? value : '{}';
  }
  return JSON.stringify(value ?? {});
}

/**
 * @description A tool call id the core gave, or null when it is a placeholder.
 * @param {unknown} id - The id.
 * @returns {string|null} The id.
 */
function realId(id) {
  if (typeof id !== 'string' || !id || PLACEHOLDER_IDS.has(id) || id.length > MAX_ID) {
    return null;
  }
  return id;
}

/**
 * @description The messages of the core -> the messages sent to AI Endpoints.
 * @param {Array<object>} messages - The messages of the core.
 * @returns {Array<object>} The messages.
 */
export function toOvhMessages(messages) {
  const out = [];
  // Calls of the last assistant turn still waiting for their result.
  let pending = [];
  const answered = new Set();
  const used = new Set();

  const closePending = () => {
    for (const callId of pending) {
      if (!answered.has(callId)) {
        out.push({ role: 'tool', tool_call_id: callId, content: MISSING_OUTPUT });
      }
    }
    pending = [];
    answered.clear();
  };

  (messages ?? []).forEach((message, position) => {
    switch (message?.role) {
      case 'system':
      case 'developer': {
        closePending();
        const text = textOf(message.content);
        if (text) {
          out.push({ role: 'system', content: text });
        }
        break;
      }
      case 'user': {
        closePending();
        const content = userContent(message.content);
        if (content.length > 0) {
          out.push({ role: 'user', content });
        }
        break;
      }
      case 'assistant': {
        closePending();
        const text = textOf(message.content);
        const calls = [];
        (Array.isArray(message.tool_calls) ? message.tool_calls : []).forEach((call, index) => {
          const name = String(call?.function?.name ?? '');
          if (!name) {
            return;
          }
          let id = realId(call?.id) ?? `call_${hash(`${position}-${index}`)}`;
          if (used.has(id)) {
            // Two calls with the same id: the second one gets its own.
            id = `call_${hash(`${id}-${position}-${index}`)}`;
          }
          used.add(id);
          calls.push({
            id,
            type: 'function',
            function: { name, arguments: argumentsString(call?.function?.arguments) },
          });
        });
        if (!text && calls.length === 0) {
          break;
        }
        const turn = { role: 'assistant', content: text || (calls.length > 0 ? null : '') };
        if (calls.length > 0) {
          turn.tool_calls = calls;
          pending = calls.map((call) => call.id);
        }
        out.push(turn);
        break;
      }
      case 'tool': {
        const id = realId(message.tool_call_id);
        const callId =
          id && pending.includes(id) && !answered.has(id)
            ? id
            : pending.find((value) => !answered.has(value));
        if (!callId) {
          // A result without its call: the model server would refuse the request.
          break;
        }
        answered.add(callId);
        out.push({
          role: 'tool',
          tool_call_id: callId,
          content: typeof message.content === 'string' ? message.content : textOf(message.content),
        });
        break;
      }
      default:
        // An unknown role is dropped: the model server would refuse the request.
        break;
    }
  });
  closePending();
  return out;
}

/**
 * @description The tools of the core, known keys only.
 * @param {Array<object>} tools - The tools of the core.
 * @returns {Array<object>} The tools.
 */
export function toOvhTools(tools) {
  return (tools ?? [])
    .filter((tool) => tool?.type === 'function' && typeof tool.function?.name === 'string')
    .map((tool) => {
      const parameters = tool.function.parameters;
      const fn = {
        name: tool.function.name,
        parameters:
          parameters && typeof parameters === 'object' && !Array.isArray(parameters)
            ? parameters
            : { type: 'object', properties: {} },
      };
      if (typeof tool.function.description === 'string' && tool.function.description) {
        fn.description = tool.function.description;
      }
      return { type: 'function', function: fn };
    });
}

/**
 * @description The tool_choice of the core.
 * @param {unknown} choice - `auto`, `none`, `required` or `{ type, function }`.
 * @returns {string|object|undefined} The value to send, undefined for the default.
 */
export function toOvhToolChoice(choice) {
  if (choice === 'required' || choice === 'any') {
    return 'required';
  }
  if (choice === 'auto' || choice === 'none') {
    return choice;
  }
  if (choice && typeof choice === 'object' && typeof choice.function?.name === 'string') {
    return { type: 'function', function: { name: choice.function.name } };
  }
  return undefined;
}

/**
 * @description An AI Endpoints completion -> the completion the core reads.
 * @param {object} response - The chat completion.
 * @returns {object} `{ id, object, model, choices: [{ message, finish_reason }], usage }`.
 */
export function toOpenAiCompletion(response) {
  const choice = response?.choices?.[0];
  const message = choice?.message ?? {};
  const responseId = String(response?.id ?? hash(JSON.stringify(message)));
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter((call) => TOOL_NAME.test(String(call?.function?.name ?? '')))
    .slice(0, MAX_TOOL_CALLS)
    .map((call, index) => ({
      id:
        typeof call.id === 'string' && call.id && call.id.length <= MAX_ID
          ? call.id
          : `call_${hash(`${responseId}-${index}`)}`,
      type: 'function',
      function: { name: call.function.name, arguments: argumentsString(call.function.arguments) },
    }));
  const text = textOf(message.content);
  const out = { role: 'assistant', content: text || (toolCalls.length > 0 ? null : '') };
  if (toolCalls.length > 0) {
    out.tool_calls = toolCalls;
  }
  let finish = choice?.finish_reason ?? 'stop';
  if (toolCalls.length > 0 && finish === 'stop') {
    finish = 'tool_calls';
  }
  return {
    id: responseId,
    object: 'chat.completion',
    model: response?.model,
    choices: [{ index: 0, message: out, finish_reason: finish }],
    usage: response?.usage,
  };
}
