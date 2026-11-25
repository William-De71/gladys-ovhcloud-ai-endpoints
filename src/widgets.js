// -----------------------------------------------------------------------------
// Dashboard widget of the AI Endpoints integration.
//
//   - `usage`  what the assistant asked AI Endpoints: requests, tokens,
//              estimated cost and errors of the day, estimated cost of the
//              month (tiles); tokens per day over 30 days (bar chart); the
//              state, the models, the last answer and the last error
//              (status); a link to the OVHcloud Control Panel.
//
// Counted by the integration from the `usage` of every answer and the prices
// of the catalog (usage.js): an estimate in US dollars, the catalog's
// currency. Requests made outside Gladys with the same project are not in it,
// and the bill of the Public Cloud project is the reference. Every text exists in the four languages (the content is cached per
// language). Budget of a card: 8 components, 1 main one, 6 tiles, 2 texts
// (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { resolveModel } from './config.js';
import { ago, formatNumber, t } from './i18n.js';
import { formatTime } from './time.js';

export const WIDGETS = { USAGE: 'usage' };
const TTL_SECONDS = 60;
/** The Public Cloud projects (AI & Machine Learning → AI Endpoints → Metrics). */
export const CONSOLE_URL = 'https://www.ovh.com/manager/#/public-cloud/pci/projects';

const LOCALES = ['en', 'fr', 'de', 'es'];

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A token count, short: "850", "12.4 k", "1.2 M" ("12,4 k" in
 * French). Not Intl's compact notation: German and Spanish do not shorten the
 * thousands with it ("50.298").
 * @param {number} value - Tokens.
 * @param {string} language - The language.
 * @returns {string} The text (≤ 12 characters).
 */
export function compactTokens(value, language) {
  const number = Number.isFinite(value) && value > 0 ? value : 0;
  const format = (amount) =>
    new Intl.NumberFormat(LOCALES.includes(language) ? language : 'en', {
      maximumFractionDigits: amount < 100 ? 1 : 0,
    }).format(amount);
  if (number >= 999_950) {
    return clip(`${format(number / 1e6)} M`, 12);
  }
  if (number >= 1000) {
    return clip(`${format(number / 1000)} k`, 12);
  }
  return String(Math.round(number));
}

/**
 * @description An estimated cost in US dollars, short: "$0.42", "0,42 $",
 * "< $0.01" for a cost too small to show, "$0" for nothing.
 * @param {number} usd - Dollars.
 * @param {string} language - The language.
 * @returns {string} The text (≤ 12 characters).
 */
export function formatCost(usd, language) {
  const value = Number.isFinite(usd) && usd > 0 ? usd : 0;
  const format = (amount, digits) =>
    new Intl.NumberFormat(LOCALES.includes(language) ? language : 'en', {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  if (value === 0) {
    return format(0, 0);
  }
  if (value < 0.01) {
    return `< ${format(0.01, 2)}`;
  }
  return clip(format(value, value < 100 ? 2 : 0), 12);
}

/**
 * @description The "usage" widget.
 * @param {object} options - Options.
 * @param {object} options.snapshot - `usage.snapshot()`.
 * @param {object} options.config - The normalized config.
 * @param {object|null} options.failing - `events.state()`.
 * @param {(id: string|null) => string} [options.modelName] - Display names.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} [options.timeZone] - The timezone of Gladys.
 * @returns {object} The content.
 */
export function buildUsageWidget({
  snapshot,
  config,
  failing,
  modelName = (id) => id ?? '–',
  language,
  now,
  timeZone,
}) {
  const time = (instant) => formatTime(instant, { language, timeZone, now });
  const chat = resolveModel(config, 'model');
  const router = resolveModel(config, 'fast_model');
  const components = [];

  if (!config.api_key) {
    components.push({ type: 'text', variant: 'body', text: clip(t('widgetNoKey', language), 300) });
  }

  const today = snapshot.today;
  components.push(
    {
      type: 'value',
      label: clip(t('tileRequestsToday', language), 24),
      value: today.requests,
      icon: 'message-circle',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      label: clip(t('tileTokensToday', language), 24),
      value: compactTokens(today.prompt_tokens + today.completion_tokens, language),
      icon: 'hash',
      color: WIDGET_COLORS.INFO,
    },
    {
      type: 'value',
      label: clip(t('tileCostToday', language), 24),
      value: formatCost(today.cost, language),
      icon: 'credit-card',
      color: WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      label: clip(t('tileCostMonth', language), 24),
      value: formatCost(snapshot.month.cost, language),
      icon: 'calendar',
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: clip(t('tileErrorsToday', language), 24),
      value: today.errors,
      icon: 'alert-triangle',
      color: today.errors > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
  );
  // Without a key the body text takes the place of the chart (8 components).
  if (config.api_key && snapshot.days.some((day) => day.tokens > 0)) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: clip(t('chartTokensTitle', language), 60),
      // Thousands: whole token counts read badly on the axis ("100000.00").
      unit: 'k',
      series: [
        {
          name: t('chartTokensSeries', language),
          points: snapshot.days.map((day) => ({
            t: `${day.date}T12:00:00Z`,
            v: Math.round(day.tokens / 100) / 10,
          })),
        },
      ],
    });
  }

  const items = [];
  if (failing) {
    items.push({
      label: clip(t('rowState', language), 40),
      value: clip(t('stateFailing', language, { time: time(failing.since) }), 40),
      color: WIDGET_COLORS.DANGER,
    });
  } else {
    items.push({
      label: clip(t('rowState', language), 40),
      value: clip(t(config.api_key ? 'stateOk' : 'stateNoKey', language), 40),
      color: config.api_key ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  items.push({
    label: clip(t('rowModels', language), 40),
    value: clip(
      chat === router ? modelName(chat) : `${modelName(chat)} · ${modelName(router)}`,
      40,
    ),
    color: WIDGET_COLORS.NEUTRAL,
  });
  const last = snapshot.last_request;
  items.push({
    label: clip(t('rowLastRequest', language), 40),
    value: clip(
      last
        ? last.ok && last.ms
          ? t('valueLastRequestTime', language, {
              use: t(`use_${last.use}`, language),
              ago: ago(last.at, now, language),
              seconds: formatNumber(last.ms / 1000, language, 1),
            })
          : t('valueLastRequest', language, {
              use: t(`use_${last.use}`, language),
              ago: ago(last.at, now, language),
            })
        : t('never', language),
      40,
    ),
    color: !last ? WIDGET_COLORS.NEUTRAL : last.ok ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  });
  const error = snapshot.last_error;
  if (error) {
    items.push({
      label: clip(t('rowLastError', language), 40),
      value: clip(`${time(error.at)} · ${t(`kind_${error.kind}`, language)}`, 40),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: clip(t('buttonConsole', language), 24),
    icon: 'external-link',
    style: 'secondary',
    link: { url: CONSOLE_URL },
  });

  return { ttl_seconds: TTL_SECONDS, components };
}
