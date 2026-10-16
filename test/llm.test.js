'use strict';

const test = require('node:test');
const assert = require('node:assert');
const llm = require('../web/llm.js');

function response(value, status) {
  const code = status || 200;
  const body = JSON.stringify(value);
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => value,
    text: async () => body,
  };
}

function textResponse(body, status) {
  const code = status || 500;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

function fakeFetch(queue) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('No fake response queued');
    return next;
  };
  return { fetch, calls, queue };
}

function anthropicReply(content, usage) {
  return response({ content, usage: usage || { input_tokens: 0, output_tokens: 0 } });
}

function openaiReply(message, usage) {
  return response({
    choices: [{ message }],
    usage: usage || { prompt_tokens: 0, completion_tokens: 0 },
  });
}

function bodyOf(call) {
  return JSON.parse(call.init.body);
}

test('Anthropic sends the expected request and returns text and usage', async () => {
  const fake = fakeFetch([anthropicReply([{ type: 'text', text: 'Ready.' }], { input_tokens: 12, output_tokens: 4 })]);
  const sampler = llm.makeSampler({ provider: 'anthropic', apiKey: 'anthropic-secret', fetch: fake.fetch });
  const result = await sampler('Hello', { system: 'Be concise.' });
  const call = fake.calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.deepStrictEqual(call.init.headers, {
    'content-type': 'application/json',
    'x-api-key': 'anthropic-secret',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  assert.equal(bodyOf(call).model, 'claude-sonnet-5-5');
  assert.equal(bodyOf(call).system, 'Be concise.');
  assert.equal(result.text, 'Ready.');
  assert.equal(result.rounds, 1);
  assert.deepStrictEqual(result.usage, { input_tokens: 12, output_tokens: 4 });
});

test('Anthropic runs tools in order and appends tool results', async () => {
  const fake = fakeFetch([
    anthropicReply([{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'call-1', name: 'get_lab', input: { a: 1 } }], { input_tokens: 5, output_tokens: 2 }),
    anthropicReply([{ type: 'text', text: 'Lab result.' }], { input_tokens: 9, output_tokens: 3 }),
  ]);
  const received = [];
  const textEvents = [];
  const sampler = llm.makeSampler({ provider: 'anthropic', apiKey: 'anthropic-secret', model: 'claude-test', fetch: fake.fetch });
  const result = await sampler('Inspect the lab', {
    tools: [{ name: 'get_lab', description: 'Read lab data', execute: async (input) => { received.push(input); return { answer: 42 }; } }],
    onText: (event) => textEvents.push(event),
  });
  assert.deepStrictEqual(received, [{ a: 1 }]);
  const secondMessages = bodyOf(fake.calls[1]).messages;
  assert.deepStrictEqual(secondMessages[1], { role: 'assistant', content: [
    { type: 'text', text: 'Checking.' },
    { type: 'tool_use', id: 'call-1', name: 'get_lab', input: { a: 1 } },
  ] });
  assert.deepStrictEqual(secondMessages[2], {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"answer":42}' }],
  });
  assert.equal(result.text, 'Checking.\n\nLab result.');
  assert.equal(result.rounds, 2);
  assert.deepStrictEqual(result.usage, { input_tokens: 14, output_tokens: 5 });
  assert.deepStrictEqual(textEvents, [
    { text: 'Checking.', delta: 'Checking.' },
    { text: 'Checking.\n\nLab result.', delta: 'Lab result.' },
  ]);
});

test('OpenAI runs JSON tool arguments and reports malformed arguments without executing them', async () => {
  const fake = fakeFetch([
    openaiReply({ role: 'assistant', content: null, tool_calls: [
      { id: 'valid-call', type: 'function', function: { name: 'get_lab', arguments: '{"a":1}' } },
      { id: 'bad-call', type: 'function', function: { name: 'get_lab', arguments: '{bad' } },
    ] }, { prompt_tokens: 7, completion_tokens: 3 }),
    openaiReply({ role: 'assistant', content: 'Done.' }, { prompt_tokens: 11, completion_tokens: 2 }),
  ]);
  const received = [];
  const sampler = llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'test-model', fetch: fake.fetch });
  const result = await sampler('Run the tool', {
    tools: [{ name: 'get_lab', description: 'Read lab data', execute: async (input) => { received.push(input); return 'ok'; } }],
  });
  assert.deepStrictEqual(received, [{ a: 1 }]);
  const secondMessages = bodyOf(fake.calls[1]).messages;
  assert.deepStrictEqual(secondMessages[1], { role: 'assistant', content: null, tool_calls: [
    { id: 'valid-call', type: 'function', function: { name: 'get_lab', arguments: '{"a":1}' } },
    { id: 'bad-call', type: 'function', function: { name: 'get_lab', arguments: '{bad' } },
  ] });
  assert.deepStrictEqual(secondMessages.slice(2), [
    { role: 'tool', tool_call_id: 'valid-call', content: '"ok"' },
    { role: 'tool', tool_call_id: 'bad-call', content: '{"error":"arguments are not valid JSON"}' },
  ]);
  assert.equal(result.text, 'Done.');
  assert.deepStrictEqual(result.usage, { input_tokens: 18, output_tokens: 5 });
});

test('OpenAI, Ollama, and OpenRouter use their required headers', async () => {
  const openai = fakeFetch([openaiReply({ role: 'assistant', content: 'ok' })]);
  await llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'test-model', fetch: openai.fetch })('hello');
  assert.equal(openai.calls[0].init.headers.authorization, 'Bearer openai-secret');

  const ollama = fakeFetch([openaiReply({ role: 'assistant', content: 'ok' })]);
  await llm.makeSampler({ provider: 'ollama', model: 'local-model', fetch: ollama.fetch })('hello');
  assert.equal(Object.hasOwn(ollama.calls[0].init.headers, 'authorization'), false);

  const openrouter = fakeFetch([openaiReply({ role: 'assistant', content: 'ok' })]);
  await llm.makeSampler({ provider: 'openrouter', apiKey: 'router-secret', model: 'test-model', fetch: openrouter.fetch })('hello');
  assert.equal(openrouter.calls[0].init.headers['HTTP-Referer'], 'https://github.com/Hadrien-Cornier/breaking-bellman');
  assert.equal(openrouter.calls[0].init.headers['X-Title'], 'Breaking Bellman');
});

test('request errors use codes and redact an echoed key', async (t) => {
  await t.test('missing key fails before fetch', async () => {
    const fake = fakeFetch([]);
    await assert.rejects(llm.makeSampler({ provider: 'openai', fetch: fake.fetch })('hello'), (error) => error.code === 'no_key');
    assert.equal(fake.calls.length, 0);
  });
  await t.test('401 maps to auth', async () => {
    const fake = fakeFetch([textResponse('unauthorized', 401)]);
    await assert.rejects(llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'm', fetch: fake.fetch })('hello'), (error) => error.code === 'auth');
  });
  await t.test('429 maps to rate_limited', async () => {
    const fake = fakeFetch([textResponse('slow down', 429)]);
    await assert.rejects(llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'm', fetch: fake.fetch })('hello'), (error) => error.code === 'rate_limited');
  });
  await t.test('500 maps to http and redacts the key', async () => {
    const fake = fakeFetch([textResponse('provider echoed openai-secret', 500)]);
    await assert.rejects(llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'm', fetch: fake.fetch })('hello'), (error) => {
      assert.equal(error.code, 'http');
      assert.match(error.message, /^HTTP 500: /);
      assert.ok(error.message.includes('[key]'));
      assert.equal(error.message.includes('openai-secret'), false);
      return true;
    });
  });
  await t.test('fetch TypeError maps to network', async () => {
    const fake = fakeFetch([new TypeError('fetch failed')]);
    await assert.rejects(llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'm', fetch: fake.fetch })('hello'), (error) => {
      assert.equal(error.code, 'network');
      assert.match(error.message, /CORS/);
      assert.match(error.message, /OLLAMA_ORIGINS=\*/);
      return true;
    });
  });
  await t.test('empty model fails before fetch', async () => {
    const fake = fakeFetch([]);
    await assert.rejects(llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', fetch: fake.fetch })('hello'), (error) => error.code === 'no_model');
    assert.equal(fake.calls.length, 0);
  });
});

test('an already-aborted signal maps to aborted before fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  const fake = fakeFetch([]);
  await assert.rejects(llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'm', fetch: fake.fetch })('hello', { signal: controller.signal }), (error) => error.code === 'aborted');
  assert.equal(fake.calls.length, 0);
});

test('maxToolRounds stops after the configured number of tool-call replies', async () => {
  const ask = (id) => openaiReply({ role: 'assistant', content: 'Working ' + id, tool_calls: [
    { id, type: 'function', function: { name: 'again', arguments: '{}' } },
  ] });
  const fake = fakeFetch([ask('one'), ask('two'), openaiReply({ role: 'assistant', content: 'must not be fetched' })]);
  const execute = async () => 'again';
  const sampler = llm.makeSampler({ provider: 'openai', apiKey: 'openai-secret', model: 'm', maxToolRounds: 2, fetch: fake.fetch });
  const result = await sampler('go', { tools: [{ name: 'again', execute }] });
  assert.equal(fake.calls.length, 2);
  assert.equal(result.rounds, 2);
  assert.equal(result.text, 'Working one\n\nWorking two');
});

test('listModels sorts IDs for Anthropic and OpenAI-compatible APIs', async () => {
  const anthropic = fakeFetch([response({ data: [{ id: 'zeta' }, { id: 'alpha' }] })]);
  assert.deepStrictEqual(await llm.listModels({ provider: 'anthropic', apiKey: 'anthropic-secret', fetch: anthropic.fetch }), ['alpha', 'zeta']);
  assert.equal(anthropic.calls[0].url, 'https://api.anthropic.com/v1/models');
  assert.equal(anthropic.calls[0].init.headers['anthropic-version'], '2023-06-01');

  const openai = fakeFetch([response({ data: [{ id: 'zeta' }, { id: 'alpha' }] })]);
  assert.deepStrictEqual(await llm.listModels({ provider: 'openai', apiKey: 'openai-secret', fetch: openai.fetch }), ['alpha', 'zeta']);
  assert.equal(openai.calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(openai.calls[0].init.headers.authorization, 'Bearer openai-secret');
});

test('a thrown Anthropic tool produces an error tool_result', async () => {
  const fake = fakeFetch([
    anthropicReply([{ type: 'tool_use', id: 'throw-call', name: 'explode', input: {} }]),
    anthropicReply([{ type: 'text', text: 'Handled.' }]),
  ]);
  const sampler = llm.makeSampler({ provider: 'anthropic', apiKey: 'anthropic-secret', model: 'm', fetch: fake.fetch });
  await sampler('try', { tools: [{ name: 'explode', execute: async () => { throw new Error('tool failed'); } }] });
  const results = bodyOf(fake.calls[1]).messages[2].content;
  assert.deepStrictEqual(results, [{ type: 'tool_result', tool_use_id: 'throw-call', content: '{"error":"tool failed"}', is_error: true }]);
});
