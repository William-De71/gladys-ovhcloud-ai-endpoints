# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-11-25

### Added

- **ai:** the Gladys AI provider on OVHcloud AI Endpoints, with the API key of the administrator's Public Cloud project: the chat and its tool calls, the intent router, the scene "ask the AI" action and the weekly digest
- **models:** a chat model and a router model among GPT-OSS 120B, Qwen 3.5 397B (reads images), Mistral Small 3.2, Qwen 3.6 35B, GPT-OSS 20B or any other language model of the catalog; reasoning level adapted to what each model accepts, dropped for a model that refuses it
- **cost:** each answer priced with the catalog prices (read every 12 hours), per day and per month
- **scenes:** triggers when the assistant fails (key refused, project without payment method, rate limit, request too large, model unavailable, API unreachable) and when it answers again
- **widgets:** requests, tokens and estimated cost of the day, estimated cost of the month, tokens per day over 30 days, last answer and last error
- **configuration:** "Test the connection" button; connection status checked against the catalog without spending anything
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-ovhcloud-ai-endpoints/releases/tag/v0.1.0
