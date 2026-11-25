# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** that makes **OVHcloud AI
Endpoints** (open models such as OpenAI GPT-OSS, Qwen and Mistral, served
from the EU data centres of OVHcloud, billed per token to a Public Cloud
project) the AI provider of a Gladys instance: a Node.js service (Node 22+,
ESM, no build step) in its own sandboxed Docker container, talking to Gladys
through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the official API (`https://oai.endpoints.kepler.ai.cloud.ovh.net/v1`,
OpenAI compatible) with the API key of the administrator's Public Cloud
project. Runtime dependency: the SDK only (plain `fetch`, no client library).
`type: "ai"`, Gladys 5.3.0+, `transports: ["cloud"]`,
`categories: ["assistants"]`. Not affiliated with OVHcloud.

The contract (SDK README, "AI providers"): one OpenAI-compatible chat
completion in (`messages`, `tools`, `tool_choice`, `max_tokens`, `purpose`,
`categories`, no `model`), one OpenAI-compatible completion out. The agentic
loop (prompts, tools, history) runs in the core; this integration only picks
the model and prepares the request. **Never tested with a real key**: the
catalog, a tool call of GPT-OSS 120B (with `reasoning_effort` and its
`message.reasoning`) and of Mistral Small 3.2, `reasoning_effort: "none"` on
Qwen 3.6 35B, the refusal of `chat_template_kwargs`, the 403 of a wrong key
and the 429 were captured from the real API without a key on 2026-11-25
(docs.ovhcloud.com guides read the same day).

## Commands

```bash
npm install
npm test                                  # node --test; a fake AI Endpoints API on 127.0.0.1
node --test test/chat.test.js             # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/manifest.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js              SDK wiring only (new GladysIntegration + createApp)
src/app.js            every handler: onAiChat, test button, widget, configuration,
                      status following the requests
src/chat.js           the AI provider: model per purpose, reasoning_effort per model,
                      retry without it when refused, images only to models that read
                      them, cut answers, usage and cost, hooks
src/convert.js        messages of the core -> AI Endpoints: calls and results paired
                      (placeholder ids, lone calls, orphans, duplicates), images;
                      the answer bounded, reasoning never kept
src/catalog.js        GET /models (12 h): which ids exist, which are language models,
                      their largest answer and their prices (USD per million tokens)
src/ovh-api.js        fetch client: chat, models, rate limit per model from the
                      ratelimit-* headers; deadline, retries on 429 / 5xx / network
                      with Retry-After, 413 never retried, keys masked
src/events.js         triggers: error (once per failure kind), recovered
src/usage.js          /data/usage.json: requests, tokens, cached tokens, estimated
                      cost per local day; costOf()
src/widgets.js        the usage widget (tokens, estimated cost)
src/connection.js     status (GET /models with the key, nothing spent) and the test button
src/config.js         model presets with their efforts / images / max output, custom id,
                      reasoning, max_tokens; effortFor(), outputBudget()
src/i18n.js           runtime texts, en / fr / de / es
src/time.js           local days and times (TZ of Gladys, Intl only)
test/helpers/fake-ovh.js         the fake API (chat, models, ratelimit headers, 403)
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **Every key users store is forever**: the keys of `config_schema` and the
  values of the `model` / `fast_model` / `reasoning` selects, `actions`, the
  widget, the triggers (fields, options, variables). `test/structure.test.js`
  compares them to `test/fixtures/manifest.baseline.json`: never update it to
  make a test pass without a documented migration. There is no scene action
  (the core's `ai.ask` already asks the provider); a future one starts with
  optional fields or defaults.
- **Model presets are AI Endpoints model ids**, case included
  (`Mistral-Small-3.2-24B-Instruct-2506`, `gpt-oss-120b`): no "latest" aliases,
  models retired with three months of notice (an `x-warning` header, then 404).
  When a preset is retired, add the successor, move the default, and let
  `normalizeConfig` map the old stored value to the default (document it in the
  changelog). "Other model" covers the rest; a model of the catalog without an
  answer length (speech, image, embedding) is refused.
- **Reasoning**: only the efforts `MODELS[id].efforts` lists are sent; GPT-OSS
  has no `none`, Mistral Small 3.2 gets nothing. AI Endpoints documents no
  reasoning parameter: `reasoning_effort` was checked on GPT-OSS and Qwen 3.6;
  `chat_template_kwargs` is refused ("feature … is not currently supported").
  A model that refuses `reasoning_effort` (400 / 422 naming it) is asked again
  without, and never gets it again until a restart.
- **Never send parameters of other providers** (`include_reasoning`,
  `service_tier`, `max_completion_tokens`, `user`): the guides of AI Endpoints
  write `max_tokens`.
- **Deadlines of the core**: the ack is awaited 20 s for
  `intent-classification`, 120 s otherwise; the handler gives up at 18 s and
  110 s. Retries (429, 5xx, network) only while the deadline leaves room; a
  Retry-After longer than 8 s fails at once. A 413 (body over 2 MB, 10 MB for
  vision models) is kind `too_large`, never retried.
- **Never fall back silently**: a failure throws (the core names it to the
  user); never answer from another provider or model, never return an empty
  turn.
- **Calls and results stay paired**: placeholder ids of the core (`unknown`,
  `tool_call_unknown`) get a stable made-up id, results take the open calls in
  order, a call left alone gets `MISSING_OUTPUT`, an orphan result is dropped.
- **The completion is bounded like the core does** (`validateAiCompletion`):
  `content` a string or null, at most 20 tool calls, names
  `^[a-zA-Z0-9_-]{1,64}$`, `arguments` a JSON string, ids at most 128
  characters. The `reasoning` / `reasoning_content` of an answer never reaches
  the core.
- **The cost is an estimate**: catalog prices (USD per token, cached tokens at
  `input_cache_reads` when above 0 — the catalog writes "0" everywhere, read as
  "no separate price" — else at the input price) times the `usage` of each
  answer, so the estimate is never below the bill.
  A model missing from the catalog costs nothing here (`costOf` returns null),
  never a made-up price. Say "estimated" wherever it is shown.
- **Scene events** once per transition: `error` when the failure kind changes,
  `recovered` at the first answer after. A refused request (`request` kind:
  HTTP 400, 422, image to a text model) starts nothing and does not change the
  status.
- **The API key** is a `secret`: never logged, never in /data, never in an
  error message (`maskKeys` hides `Bearer …`, JWT-like tokens and the sign-in
  link of the 403). Never call without a key.
- **The container rootfs is read-only.** Write only under `/data` (usage
  counters, written at most every 10 s and at shutdown).
- **Four languages.** Every user-facing text (manifest, `src/i18n.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted". Tile labels stay within about 13
  characters (the dashboard truncates them).
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Logo**: the OVHcloud logo names the service only; keep the "not
  affiliated" notices.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- A wrong or revoked key is a **403** `{"message":"Forbidden: authentication
failed. Please generate a new one at https://kepler…"}`, not a 401, also on
  `GET /models` (captured 2026-11-25). `GET /models` with the key proves it
  without spending anything; without a key it answers 200 to anyone.
- A key of a project in Discovery mode (no payment method): "Resource tag
  'discovery' is forbidden" (docs: troubleshooting) → kind `project`.
- Without a key the documentation says 2 requests a minute, but the API
  answered `x-ratelimit-limit-year: 1` (one request a year per model and per
  address) on 2026-11-25. Do not spend these on tests.
- Error bodies are `{ "message": … }` at the top level (Kong), not OpenAI's
  `{ "error": { … } }`; `errorMessageOf` reads both.
- Limits arrive as `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`
  (seconds), per minute with a key (400 per project and per model).
- GPT-OSS answers a tool call with `content: ""` and `message.reasoning`:
  the empty text becomes `null` next to the calls.
- Llama models do not support several tool calls between user and assistant
  messages (docs: function calling): not offered as a preset.
- `parallel_tool_calls: false` is not supported (docs): never send it.
- `AbortSignal.timeout` does not keep the process alive: a test that waits on
  it needs its own timer.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
