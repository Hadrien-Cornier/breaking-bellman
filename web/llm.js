// web/llm.js: bring-your-own-key chat client (Anthropic, OpenAI, OpenRouter, Ollama, any OpenAI-compatible server).
// No server: the browser sends the request straight to the provider with the key the player typed.
(function () {
  'use strict';
  const BB = (globalThis.BB = globalThis.BB || {});
  const PROVIDERS = {
    anthropic: { label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', needsKey: true, defaultModel: 'claude-sonnet-5-5' },
    openai: { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true, defaultModel: '' },
    openrouter: { label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, defaultModel: '' },
    ollama: { label: 'Ollama (on this computer)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', needsKey: false, defaultModel: '' },
    custom: { label: 'Other OpenAI-compatible server', kind: 'openai', baseUrl: '', needsKey: false, defaultModel: '' },
  };

  function redact(text, key) {
    const value = String(text);
    const secret = key == null ? '' : String(key);
    return secret.length >= 6 ? value.split(secret).join('[key]') : value;
  }

  function makeError(code, message, key) {
    const error = new Error(redact(message, key));
    error.code = code;
    return error;
  }

  function getConfig(settings) {
    const provider = PROVIDERS[settings.provider];
    if (!provider) throw makeError('provider', 'Unknown provider: ' + settings.provider, settings.apiKey);
    const apiKey = settings.apiKey == null ? '' : String(settings.apiKey);
    if (provider.needsKey && !apiKey) throw makeError('no_key', 'Enter an API key for ' + provider.label + '.', apiKey);
    const model = settings.model || provider.defaultModel;
    if (!model) throw makeError('no_model', 'Select a model before sending a message.', apiKey);
    const baseUrl = String(settings.baseUrl || provider.baseUrl || '').replace(/\/+$/, '');
    const fetchFn = settings.fetch || globalThis.fetch;
    if (typeof fetchFn !== 'function') throw makeError('network', 'The browser could not reach the server because fetch is unavailable.', apiKey);
    return { provider, apiKey, model, baseUrl, fetchFn };
  }

  function headersFor(config) {
    if (config.provider.kind === 'anthropic') {
      return {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    }
    const headers = { 'content-type': 'application/json' };
    if (config.apiKey) headers.authorization = 'Bearer ' + config.apiKey;
    if (config.provider === PROVIDERS.openrouter) {
      headers['HTTP-Referer'] = 'https://github.com/Hadrien-Cornier/breaking-bellman';
      headers['X-Title'] = 'Breaking Bellman';
    }
    return headers;
  }

  async function request(config, url, init, signal) {
    if (signal && signal.aborted) throw makeError('aborted', 'The request was aborted.', config.apiKey);
    if (signal) init.signal = signal;
    let response;
    try {
      response = await config.fetchFn(url, init);
    } catch (error) {
      if ((error && error.name === 'AbortError') || (signal && signal.aborted)) {
        throw makeError('aborted', 'The request was aborted.', config.apiKey);
      }
      if (error instanceof TypeError || (error && error.name === 'TypeError')) {
        throw makeError('network', 'The browser could not reach the server. The server must allow requests from this page (CORS). For Ollama, start it with OLLAMA_ORIGINS=*.', config.apiKey);
      }
      throw makeError('network', error && error.message ? error.message : 'The browser could not reach the server.', config.apiKey);
    }
    if (!response.ok) {
      let body = '';
      try {
        if (typeof response.text === 'function') body = await response.text();
        else if (typeof response.json === 'function') body = JSON.stringify(await response.json());
      } catch (_) {
        body = '';
      }
      const status = response.status;
      const code = status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate_limited' : 'http';
      throw makeError(code, 'HTTP ' + status + ': ' + String(body).slice(0, 300), config.apiKey);
    }
    try {
      return await response.json();
    } catch (error) {
      throw makeError('response', error && error.message ? error.message : 'The server returned an invalid response.', config.apiKey);
    }
  }

  function inputMessages(input) {
    return (Array.isArray(input) ? input : [{ role: 'user', content: input }]).map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  function toolError(error, key) {
    const message = error && error.message ? error.message : String(error);
    return { error: redact(message, key) };
  }

  async function runTool(tool, args, key) {
    try {
      const result = await tool.execute(args);
      const content = JSON.stringify(result ?? null);
      return { content: String(content === undefined ? 'null' : content).slice(0, 8000), isError: false };
    } catch (error) {
      return { content: JSON.stringify(toolError(error, key)).slice(0, 8000), isError: true };
    }
  }

  function toolByName(tools, name) {
    return tools.find((tool) => tool.name === name);
  }

  function toolResultForUnknown(name) {
    return JSON.stringify({ error: 'unknown tool ' + name }).slice(0, 8000);
  }

  function extractAnthropicText(content) {
    return (Array.isArray(content) ? content : []).filter((block) => block && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
  }

  function addText(text, newPiece, onText) {
    if (!newPiece) return;
    text.push(newPiece);
    if (typeof onText === 'function') onText({ text: text.join('\n\n'), delta: newPiece });
  }

  async function sample(settings, input, opts) {
    opts = opts || {};
    const config = getConfig(settings);
    const messages = inputMessages(input);
    const tools = Array.isArray(opts.tools) ? opts.tools : [];
    const maxTokens = settings.maxTokens === undefined ? 1500 : settings.maxTokens;
    const maxToolRounds = settings.maxToolRounds === undefined ? 8 : settings.maxToolRounds;
    const text = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let rounds = 0;
    let toolRounds = 0;

    while (true) {
      if (opts.signal && opts.signal.aborted) throw makeError('aborted', 'The request was aborted.', config.apiKey);
      let url;
      let body;
      if (config.provider.kind === 'anthropic') {
        url = config.baseUrl + '/messages';
        body = { model: config.model, max_tokens: maxTokens, messages };
        if (opts.system) body.system = opts.system;
        if (tools.length) body.tools = tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema || { type: 'object', properties: {} },
        }));
      } else {
        url = config.baseUrl + '/chat/completions';
        // OpenAI's newer models take max_completion_tokens; other OpenAI-compatible servers take max_tokens
        body = config.provider === PROVIDERS.openai ? { model: config.model, max_completion_tokens: maxTokens, messages: [] } : { model: config.model, max_tokens: maxTokens, messages: [] };
        if (opts.system) body.messages.push({ role: 'system', content: opts.system });
        body.messages.push(...messages);
        if (tools.length) body.tools = tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema || { type: 'object', properties: {} } },
        }));
      }

      const reply = await request(config, url, { method: 'POST', headers: headersFor(config), body: JSON.stringify(body) }, opts.signal);
      rounds += 1;
      let toolCalls;
      if (config.provider.kind === 'anthropic') {
        inputTokens += Number(reply.usage && reply.usage.input_tokens || 0);
        outputTokens += Number(reply.usage && reply.usage.output_tokens || 0);
        addText(text, extractAnthropicText(reply.content), opts.onText);
        toolCalls = (Array.isArray(reply.content) ? reply.content : []).filter((block) => block && block.type === 'tool_use');
        if (!toolCalls.length) break;
        toolRounds += 1;
        if (toolRounds >= maxToolRounds) break;
        messages.push({ role: 'assistant', content: reply.content });
        const results = [];
        for (const call of toolCalls) {
          const tool = toolByName(tools, call.name);
          if (!tool) {
            results.push({ type: 'tool_result', tool_use_id: call.id, content: toolResultForUnknown(call.name) });
            continue;
          }
          const result = await runTool(tool, call.input, config.apiKey);
          const item = { type: 'tool_result', tool_use_id: call.id, content: result.content };
          if (result.isError) item.is_error = true;
          results.push(item);
        }
        messages.push({ role: 'user', content: results });
      } else {
        inputTokens += Number(reply.usage && reply.usage.prompt_tokens || 0);
        outputTokens += Number(reply.usage && reply.usage.completion_tokens || 0);
        const choice = reply.choices && reply.choices[0];
        const message = choice && choice.message || {};
        addText(text, typeof message.content === 'string' ? message.content : '', opts.onText);
        toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        if (!toolCalls.length) break;
        toolRounds += 1;
        if (toolRounds >= maxToolRounds) break;
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
        for (const call of toolCalls) {
          const tool = toolByName(tools, call.function && call.function.name);
          let args;
          try {
            const raw = call.function && call.function.arguments;
            args = raw === '' ? {} : JSON.parse(raw);
          } catch (_) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'arguments are not valid JSON' }) });
            continue;
          }
          if (!tool) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: toolResultForUnknown(call.function && call.function.name) });
            continue;
          }
          const result = await runTool(tool, args, config.apiKey);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });
        }
      }
    }

    return { text: text.join('\n\n'), rounds, usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
  }

  function makeSampler(settings) {
    settings = settings || {};
    return function (input, opts) {
      return sample(settings, input, opts);
    };
  }

  async function listModels(settings) {
    settings = settings || {};
    const config = getConfig(Object.assign({}, settings, { model: settings.model || 'models-list' }));
    const headers = headersFor(config);
    const response = await request(config, config.baseUrl + '/models', { method: 'GET', headers }, settings.signal);
    return (Array.isArray(response.data) ? response.data : []).map((model) => model.id).filter((id) => typeof id === 'string').sort();
  }

  BB.llm = { PROVIDERS, makeSampler, listModels, redact };
  if (typeof module === 'object' && module.exports) module.exports = BB.llm;
})();
