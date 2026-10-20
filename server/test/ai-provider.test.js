import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatBody,
  buildSearchBody,
  isReasoningModel,
  resolveProvider,
  supportsTemperature,
} from '../src/ai-provider.js';

test('the provider is chosen explicitly when AI_PROVIDER is set', () => {
  const provider = resolveProvider({ AI_PROVIDER: 'xai', XAI_API_KEY: 'x-key' });
  assert.equal(provider.id, 'xai');
  assert.equal(provider.apiKeyEnv, 'XAI_API_KEY');
  assert.equal(provider.model, 'grok-4.20-0309-non-reasoning');
});

test('a configured OpenAI key selects OpenAI without an explicit provider', () => {
  const provider = resolveProvider({ OPENAI_API_KEY: 'o-key' });
  assert.equal(provider.id, 'openai');
  assert.equal(provider.apiKey, 'o-key');
  assert.equal(provider.model, 'gpt-4.1');
  assert.equal(provider.hasKey, true);
});

test('a configured xAI key is used when OpenAI is not configured', () => {
  const provider = resolveProvider({ XAI_API_KEY: 'x-key' });
  assert.equal(provider.id, 'xai');
  assert.equal(provider.hasKey, true);
});

test('the model can be overridden per provider', () => {
  assert.equal(resolveProvider({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-5.4-mini' }).model, 'gpt-5.4-mini');
  assert.equal(resolveProvider({ AI_PROVIDER: 'xai', XAI_API_KEY: 'k', XAI_MODEL: 'grok-4' }).model, 'grok-4');
});

test('reasoning models are detected and do not accept a custom temperature', () => {
  assert.equal(isReasoningModel('gpt-5.4'), true);
  assert.equal(isReasoningModel('o3'), true);
  assert.equal(isReasoningModel('gpt-4.1'), false);
  assert.equal(supportsTemperature('gpt-5.4'), false);
  assert.equal(supportsTemperature('gpt-4.1'), true);
});

test('OpenAI chat requests use max_completion_tokens and no stored output', () => {
  const provider = resolveProvider({ OPENAI_API_KEY: 'k' });
  const body = buildChatBody({
    provider, model: 'gpt-4.1', systemText: 'sys', userMsg: 'hi', maxTokens: 900,
  });
  assert.equal(body.max_completion_tokens, 900);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, 0.7);
  assert.equal(body.store, false);
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].content, 'hi');
});

test('xAI chat requests keep max_tokens and no store flag', () => {
  const provider = resolveProvider({ AI_PROVIDER: 'xai', XAI_API_KEY: 'k' });
  const body = buildChatBody({
    provider, model: 'grok-4.20-0309-non-reasoning', systemText: 'sys', userMsg: 'hi', maxTokens: 700,
  });
  assert.equal(body.max_tokens, 700);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.store, undefined);
});

test('reasoning models are sent without a temperature override', () => {
  const provider = resolveProvider({ OPENAI_API_KEY: 'k' });
  const body = buildChatBody({
    provider, model: 'gpt-5.4', systemText: 'sys', userMsg: 'hi', maxTokens: 500,
  });
  assert.equal(body.temperature, undefined);
  assert.equal(body.max_completion_tokens, 500);
});

test('image requests are sent as base64 image parts with a text part', () => {
  const provider = resolveProvider({ OPENAI_API_KEY: 'k' });
  const body = buildChatBody({
    provider, model: 'gpt-4.1', systemText: 'sys', userMsg: 'describe', maxTokens: 100,
    images: [{ mimetype: 'image/jpeg', base64: 'AAAA' }],
  });
  const parts = body.messages[1].content;
  assert.equal(Array.isArray(parts), true);
  assert.equal(parts[0].type, 'image_url');
  assert.equal(parts[0].image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.equal(parts[1].type, 'text');
  assert.equal(parts[1].text, 'describe');
});

test('OpenAI live search uses the web_search_preview tool and instructions input', () => {
  const provider = resolveProvider({ OPENAI_API_KEY: 'k' });
  const body = buildSearchBody({ provider, model: 'gpt-4.1', systemText: 'sys', userMsg: 'trend' });
  assert.deepEqual(body.tools, [{ type: 'web_search_preview' }]);
  assert.equal(body.instructions, 'sys');
  assert.equal(body.input, 'trend');
  assert.equal(body.max_output_tokens, 950);
});

test('xAI live search keeps the web and x search tools', () => {
  const provider = resolveProvider({ AI_PROVIDER: 'xai', XAI_API_KEY: 'k' });
  const body = buildSearchBody({ provider, model: 'grok-4.20-0309-non-reasoning', systemText: 'sys', userMsg: 'trend' });
  assert.deepEqual(body.tools, [{ type: 'web_search' }, { type: 'x_search' }]);
  assert.equal(body.instructions, undefined);
  assert.equal(Array.isArray(body.input), true);
});
