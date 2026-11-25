// -----------------------------------------------------------------------------
// Entry point of the OVHcloud AI Endpoints external integration.
//
// An AI provider (manifest `type: "ai"`): once an administrator selects it in
// Settings, Artificial Intelligence, every AI request of the Gladys instance —
// the chat and its tool calls, the intent router, the scene `ai.ask` action,
// the weekly digest — is answered by a model of OVHcloud AI Endpoints (open
// models such as GPT-OSS, Qwen and Mistral, hosted in the European Union),
// with the API key of the administrator's Public Cloud project. On top of
// that:
//   - scene triggers: AI Endpoints fails / answers again;
//   - dashboard widget: requests, tokens and estimated cost.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the days of the usage counters)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the OVHcloud AI Endpoints integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
