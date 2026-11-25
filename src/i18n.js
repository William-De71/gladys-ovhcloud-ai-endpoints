// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: connection statuses, the result of the test button, the widget.
// German says "du", Spanish "usted", like Gladys. Model names are never
// translated.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // connection status and test action
  statusNoKey: {
    en: 'No AI Endpoints API key: create one in the OVHcloud Control Panel (Public Cloud, AI Endpoints, API keys) and paste it in the configuration.',
    fr: 'Pas de clé d’API AI Endpoints : créez-en une dans l’espace client OVHcloud (Public Cloud, AI Endpoints, API keys) et collez-la dans la configuration.',
    de: 'Kein AI-Endpoints-API-Schlüssel: Erstelle einen im OVHcloud Control Panel (Public Cloud, AI Endpoints, API keys) und füge ihn in die Konfiguration ein.',
    es: 'No hay clave de API de AI Endpoints: cree una en el área de cliente de OVHcloud (Public Cloud, AI Endpoints, API keys) y péguela en la configuración.',
  },
  statusBadKey: {
    en: 'AI Endpoints refused the API key (wrong, expired or revoked): create a new one in the OVHcloud Control Panel.',
    fr: 'AI Endpoints a refusé la clé d’API (fausse, expirée ou révoquée) : créez-en une nouvelle dans l’espace client OVHcloud.',
    de: 'AI Endpoints hat den API-Schlüssel abgelehnt (falsch, abgelaufen oder widerrufen): Erstelle einen neuen im OVHcloud Control Panel.',
    es: 'AI Endpoints ha rechazado la clave de API (errónea, caducada o revocada): cree una nueva en el área de cliente de OVHcloud.',
  },
  statusProject: {
    en: 'The Public Cloud project of this key is in Discovery mode: add a payment method to the project, then create a new key.',
    fr: 'Le projet Public Cloud de cette clé est en mode Découverte : ajoutez un moyen de paiement au projet, puis créez une nouvelle clé.',
    de: 'Das Public-Cloud-Projekt dieses Schlüssels ist im Discovery-Modus: Füge dem Projekt eine Zahlungsmethode hinzu und erstelle dann einen neuen Schlüssel.',
    es: 'El proyecto Public Cloud de esta clave está en modo Discovery: añada un método de pago al proyecto y luego cree una clave nueva.',
  },
  statusNoModel: {
    en: '{model} is not in the AI Endpoints catalog (wrong id or retired model): choose another model.',
    fr: '{model} n’est pas dans le catalogue d’AI Endpoints (identifiant faux ou modèle retiré) : choisissez un autre modèle.',
    de: '{model} ist nicht im Katalog von AI Endpoints (falsche ID oder eingestelltes Modell): Wähle ein anderes Modell.',
    es: '{model} no está en el catálogo de AI Endpoints (identificador erróneo o modelo retirado): elija otro modelo.',
  },
  statusNotChat: {
    en: '{model} is not a language model (speech, image or embedding model): choose a chat model.',
    fr: '{model} n’est pas un modèle de langage (voix, image ou plongements) : choisissez un modèle de discussion.',
    de: '{model} ist kein Sprachmodell (Sprach-, Bild- oder Embedding-Modell): Wähle ein Chat-Modell.',
    es: '{model} no es un modelo de lenguaje (voz, imagen o embeddings): elija un modelo de chat.',
  },
  statusNoCustom: {
    en: 'A model is set to “Other model” but the model id field is empty or invalid.',
    fr: 'Un modèle est réglé sur « Autre modèle » mais le champ de l’identifiant est vide ou invalide.',
    de: 'Ein Modell steht auf „Anderes Modell“, aber das Feld der Modell-ID ist leer oder ungültig.',
    es: 'Un modelo está en «Otro modelo» pero el campo del identificador está vacío o no es válido.',
  },
  statusRateLimited: {
    en: 'AI Endpoints rate limit reached (400 requests a minute per project and per model): try again in a minute.',
    fr: 'Limite d’AI Endpoints atteinte (400 requêtes par minute, par projet et par modèle) : réessayez dans une minute.',
    de: 'AI-Endpoints-Limit erreicht (400 Anfragen pro Minute je Projekt und Modell): Versuche es in einer Minute erneut.',
    es: 'Se ha alcanzado el límite de AI Endpoints (400 solicitudes por minuto por proyecto y modelo): inténtelo dentro de un minuto.',
  },
  statusTooLarge: {
    en: 'A request of the assistant is too large for AI Endpoints (2 MB, 10 MB for the vision models): send smaller images.',
    fr: 'Une requête de l’assistant est trop grosse pour AI Endpoints (2 Mo, 10 Mo pour les modèles de vision) : envoyez des images plus petites.',
    de: 'Eine Anfrage des Assistenten ist zu groß für AI Endpoints (2 MB, 10 MB bei Bildmodellen): Sende kleinere Bilder.',
    es: 'Una solicitud del asistente es demasiado grande para AI Endpoints (2 MB, 10 MB para los modelos de visión): envíe imágenes más pequeñas.',
  },
  statusUnreachable: {
    en: 'Cannot reach AI Endpoints (oai.endpoints.kepler.ai.cloud.ovh.net): check the internet access of Gladys.',
    fr: 'Impossible de joindre AI Endpoints (oai.endpoints.kepler.ai.cloud.ovh.net) : vérifiez l’accès Internet de Gladys.',
    de: 'AI Endpoints ist nicht erreichbar (oai.endpoints.kepler.ai.cloud.ovh.net): Prüfe den Internetzugang von Gladys.',
    es: 'No se puede acceder a AI Endpoints (oai.endpoints.kepler.ai.cloud.ovh.net): compruebe el acceso a Internet de Gladys.',
  },
  statusApiError: {
    en: 'AI Endpoints error: {detail}',
    fr: 'Erreur d’AI Endpoints : {detail}',
    de: 'AI-Endpoints-Fehler: {detail}',
    es: 'Error de AI Endpoints: {detail}',
  },
  statusInitFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  role_chat: { en: 'Chat', fr: 'Discussion', de: 'Chat', es: 'Chat' },
  role_router: { en: 'Router', fr: 'Routeur', de: 'Router', es: 'Enrutador' },
  testAnswered: {
    en: '{model} answered in {seconds} s.',
    fr: '{model} a répondu en {seconds} s.',
    de: '{model} hat in {seconds} s geantwortet.',
    es: '{model} ha respondido en {seconds} s.',
  },
  testRequestsLeft: {
    en: '{left} of {limit} requests left this minute.',
    fr: 'Il reste {left} requêtes sur {limit} pour cette minute.',
    de: 'In dieser Minute noch {left} von {limit} Anfragen.',
    es: 'Quedan {left} de {limit} solicitudes en este minuto.',
  },

  // widget
  widgetNoKey: {
    en: 'No AI Endpoints API key yet: add it in the configuration of the integration, then choose OVHcloud AI Endpoints in Settings, Artificial Intelligence.',
    fr: 'Pas encore de clé d’API AI Endpoints : ajoutez-la dans la configuration de l’intégration, puis choisissez OVHcloud AI Endpoints dans Paramètres, Intelligence artificielle.',
    de: 'Noch kein AI-Endpoints-API-Schlüssel: Füge ihn in der Konfiguration der Integration hinzu und wähle dann OVHcloud AI Endpoints unter Einstellungen, Künstliche Intelligenz.',
    es: 'Todavía no hay clave de API de AI Endpoints: añádala en la configuración de la integración y luego elija OVHcloud AI Endpoints en Ajustes, Inteligencia artificial.',
  },
  tileRequestsToday: {
    en: 'Requests today',
    fr: 'Appels du jour',
    de: 'Anfragen heute',
    es: 'Solicitudes hoy',
  },
  tileTokensToday: {
    en: 'Tokens today',
    fr: 'Jetons du jour',
    de: 'Tokens heute',
    es: 'Tokens hoy',
  },
  tileCostToday: {
    en: 'Cost today',
    fr: 'Coût du jour',
    de: 'Kosten heute',
    es: 'Coste hoy',
  },
  tileCostMonth: {
    en: 'Month cost',
    fr: 'Coût du mois',
    de: 'Monatskosten',
    es: 'Coste del mes',
  },
  tileErrorsToday: {
    en: 'Errors today',
    fr: 'Erreurs du jour',
    de: 'Fehler heute',
    es: 'Errores hoy',
  },
  chartTokensTitle: {
    en: 'Thousands of tokens per day',
    fr: 'Milliers de jetons par jour',
    de: 'Tausend Tokens pro Tag',
    es: 'Miles de tokens por día',
  },
  chartTokensSeries: { en: 'Tokens', fr: 'Jetons', de: 'Tokens', es: 'Tokens' },
  buttonConsole: {
    en: 'OVHcloud console',
    fr: 'Espace client OVHcloud',
    de: 'OVHcloud-Konsole',
    es: 'Consola OVHcloud',
  },
  rowState: { en: 'AI Endpoints', fr: 'AI Endpoints', de: 'AI Endpoints', es: 'AI Endpoints' },
  stateOk: { en: 'Answering', fr: 'Répond', de: 'Antwortet', es: 'Responde' },
  stateNoKey: {
    en: 'No API key',
    fr: 'Pas de clé d’API',
    de: 'Kein API-Schlüssel',
    es: 'Sin clave de API',
  },
  stateFailing: {
    en: 'Failing since {time}',
    fr: 'En erreur depuis {time}',
    de: 'Fehler seit {time}',
    es: 'Con errores desde {time}',
  },
  rowModels: { en: 'Models', fr: 'Modèles', de: 'Modelle', es: 'Modelos' },
  rowLastRequest: {
    en: 'Last request',
    fr: 'Dernière requête',
    de: 'Letzte Anfrage',
    es: 'Última solicitud',
  },
  valueLastRequest: {
    en: '{use}, {ago}',
    fr: '{use}, {ago}',
    de: '{use}, {ago}',
    es: '{use}, {ago}',
  },
  valueLastRequestTime: {
    en: '{use}, {ago} ({seconds} s)',
    fr: '{use}, {ago} ({seconds} s)',
    de: '{use}, {ago} ({seconds} s)',
    es: '{use}, {ago} ({seconds} s)',
  },
  rowLastError: {
    en: 'Last error',
    fr: 'Dernière erreur',
    de: 'Letzter Fehler',
    es: 'Último error',
  },
  use_chat: { en: 'chat', fr: 'discussion', de: 'Chat', es: 'chat' },
  use_router: { en: 'router', fr: 'routeur', de: 'Router', es: 'enrutador' },
  use_digest: {
    en: 'weekly digest',
    fr: 'résumé hebdo',
    de: 'Wochenrückblick',
    es: 'resumen semanal',
  },
  kind_auth: {
    en: 'key refused',
    fr: 'clé refusée',
    de: 'Schlüssel abgelehnt',
    es: 'clave rechazada',
  },
  kind_project: {
    en: 'project without payment',
    fr: 'projet sans paiement',
    de: 'Projekt ohne Zahlung',
    es: 'proyecto sin pago',
  },
  kind_model: {
    en: 'model unavailable',
    fr: 'modèle indisponible',
    de: 'Modell nicht verfügbar',
    es: 'modelo no disponible',
  },
  kind_rate_limit: {
    en: 'rate limit',
    fr: 'limite de requêtes',
    de: 'Anfragelimit',
    es: 'límite de solicitudes',
  },
  kind_too_large: {
    en: 'request too large',
    fr: 'requête trop grosse',
    de: 'Anfrage zu groß',
    es: 'solicitud muy grande',
  },
  kind_request: {
    en: 'request refused',
    fr: 'requête refusée',
    de: 'Anfrage abgelehnt',
    es: 'solicitud rechazada',
  },
  kind_server: {
    en: 'AI Endpoints error',
    fr: 'erreur d’AI Endpoints',
    de: 'AI-Endpoints-Fehler',
    es: 'error de AI Endpoints',
  },
  kind_unreachable: {
    en: 'unreachable',
    fr: 'injoignable',
    de: 'nicht erreichbar',
    es: 'inaccesible',
  },
  kind_timeout: { en: 'too slow', fr: 'trop lent', de: 'zu langsam', es: 'demasiado lento' },

  // durations
  never: { en: 'Never', fr: 'Jamais', de: 'Nie', es: 'Nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: {
    en: '{n} days ago',
    fr: 'il y a {n} jours',
    de: 'vor {n} Tagen',
    es: 'hace {n} días',
  },
};

/**
 * @description Whether a value is a language of the integration.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, with its values.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The values of the `{placeholders}`.
 * @returns {string} The text, the key itself when unknown.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string|Function} key - A TEXTS key, or `(language) => text`.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function'
        ? key(language)
        : t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description How long ago an instant was: "just now", "12 min ago", "3 h ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) {
    return t('never', language);
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return t('justNow', language);
  }
  if (minutes < 60) {
    return t('minutesAgo', language, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t('hoursAgo', language, { n: hours });
  }
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

/**
 * @description A number in the format of a language.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [decimals] - The decimals at most.
 * @returns {string} "12,5" in French.
 */
function formatNumber(value, language, decimals = 1) {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
    maximumFractionDigits: decimals,
  }).format(value);
}

export { LANGUAGES, TEXTS, isLanguage, t, all, ago, formatNumber };
