// Single place that decides which AI vendor serves captions, cover selection,
// brand checks and speech-to-text. xAI (Grok) and OpenAI (ChatGPT) speak a very
// similar Chat Completions shape, but they differ in four places: the base
// URL, the API key variable, the token-budget field name, and whether the
// model accepts a temperature. Keeping those differences here means the rest
// of the server never branches on the vendor.

export const PROVIDER_IDS = ['openai', 'xai'];

const OPENAI = {
  id: 'openai',
  label: 'OpenAI',
  apiKeyEnv: 'OPENAI_API_KEY',
  modelEnv: 'OPENAI_MODEL',
  defaultModel: 'gpt-4.1',
  chatUrl: 'https://api.openai.com/v1/chat/completions',
  responsesUrl: 'https://api.openai.com/v1/responses',
  // OpenAI calls the live-search tool "web_search_preview"; xAI calls it
  // "web_search" and adds a separate "x_search" tool.
  searchTools: ['web_search_preview'],
  maxTokensField: 'max_completion_tokens',
  transcribe: {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    modelEnv: 'OPENAI_TRANSCRIBE_MODEL',
    defaultModel: 'gpt-4o-transcribe',
  },
};

const XAI = {
  id: 'xai',
  label: 'xAI (Grok)',
  apiKeyEnv: 'XAI_API_KEY',
  modelEnv: 'XAI_MODEL',
  defaultModel: 'grok-4.20-0309-non-reasoning',
  chatUrl: 'https://api.x.ai/v1/chat/completions',
  responsesUrl: 'https://api.x.ai/v1/responses',
  searchTools: ['web_search', 'x_search'],
  maxTokensField: 'max_tokens',
  transcribe: {
    url: 'https://api.x.ai/v1/stt',
    modelEnv: 'XAI_TRANSCRIBE_MODEL',
    defaultModel: 'grok-voice-transcribe-2.0',
  },
};

const CONFIGS = { openai: OPENAI, xai: XAI };

export function getProviderConfig(id) {
  return CONFIGS[id] || null;
}

// Reasoning models (o-series, gpt-5 family) reject a custom temperature and
// count reasoning tokens inside the output budget, so they get a different
// request shape.
export function isReasoningModel(model) {
  return /^(o\d|gpt-5)/i.test(String(model || '').trim());
}

export function supportsTemperature(model) {
  return !isReasoningModel(model);
}

// Provider selection order:
//   1. explicit AI_PROVIDER ("openai" | "xai")
//   2. whichever API key is actually configured
//   3. OpenAI as the default target
export function resolveProvider(env = process.env) {
  const requested = String(env.AI_PROVIDER || '').trim().toLowerCase();
  const config = CONFIGS[requested]
    || (env.OPENAI_API_KEY ? OPENAI : env.XAI_API_KEY ? XAI : OPENAI);
  const apiKey = String(env[config.apiKeyEnv] || '').trim();
  const model = String(env[config.modelEnv] || '').trim() || config.defaultModel;
  return {
    id: config.id,
    label: config.label,
    config,
    apiKey,
    model,
    apiKeyEnv: config.apiKeyEnv,
    modelEnv: config.modelEnv,
    hasKey: !!apiKey,
  };
}

// Same shape for the Chat Completions call, with the vendor differences
// applied: token budget field, temperature support and response storage.
export function buildChatBody({ provider, model, systemText, userMsg, images = [], maxTokens, temperature = 0.7 }) {
  const body = {
    model: model || provider.config.defaultModel,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: String(systemText ?? '') },
      { role: 'user', content: images.length ? [
        ...images.map((image) => ({
          type: 'image_url',
          image_url: { url: `data:${image.mimetype};base64,${image.base64}`, detail: 'high' },
        })),
        { type: 'text', text: String(userMsg ?? '') },
      ] : String(userMsg ?? '') },
    ],
  };
  body[provider.config.maxTokensField] = maxTokens;
  if (supportsTemperature(body.model)) body.temperature = temperature;
  // User briefs and captions are private content: never keep a copy.
  if (provider.id === 'openai') body.store = false;
  return body;
}

// Live-search request (the "Live SEO" trend mode).
export function buildSearchBody({ provider, model, systemText, userMsg, maxTokens = 950, temperature = 0.7 }) {
  const body = {
    model: model || provider.config.defaultModel,
    max_output_tokens: maxTokens,
    tools: provider.config.searchTools.map((type) => ({ type })),
  };
  if (supportsTemperature(body.model)) body.temperature = temperature;
  if (provider.id === 'openai') {
    // OpenAI's Responses API takes the system prompt as `instructions`.
    body.instructions = String(systemText ?? '');
    body.input = String(userMsg ?? '');
    body.store = false;
  } else {
    body.input = [
      { role: 'system', content: String(systemText ?? '') },
      { role: 'user', content: String(userMsg ?? '') },
    ];
  }
  return body;
}

export function providerNotConfiguredMessage(provider) {
  return `AI is not configured yet (${provider.apiKeyEnv} missing)`;
}
