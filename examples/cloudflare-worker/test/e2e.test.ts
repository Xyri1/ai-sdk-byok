import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker, { type Env } from '../src/index';

const workerEnv = env as unknown as Env;

const OPENAI_STYLE_SSE = [
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1752710400,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
  '',
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1752710400,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"Hello from the mock"},"finish_reason":null}]}`,
  '',
  `data: {"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1752710400,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":4,"total_tokens":5}}`,
  '',
  'data: [DONE]',
  '',
].join('\n');

const ANTHROPIC_SSE = [
  `event: message_start`,
  `data: {"type":"message_start","message":{"id":"msg_mock","type":"message","role":"assistant","model":"claude-mock","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}`,
  '',
  `event: content_block_start`,
  `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
  '',
  `event: content_block_delta`,
  `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from the mock"}}`,
  '',
  `event: content_block_stop`,
  `data: {"type":"content_block_stop","index":0}`,
  '',
  `event: message_delta`,
  `data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}`,
  '',
  `event: message_stop`,
  `data: {"type":"message_stop"}`,
  '',
].join('\n');

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), workerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function saveKey(apiKey: string, provider = 'openai'): Promise<{ id: string }> {
  const response = await call('/api/keys', json({ provider, apiKey }));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cloudflare worker example end to end', () => {
  it('saves a key and returns metadata only', async () => {
    const response = await call('/api/keys', json({ provider: 'openai', apiKey: 'sk-mock-1234' }));

    expect(response.status).toBe(201);
    const body = await response.text();
    expect(body).not.toContain('sk-mock-1234');
    expect(JSON.parse(body)).toMatchObject({ provider: 'openai', label: 'default', keyHint: '1234' });
  });

  it('rejects invalid input with a 400', async () => {
    const response = await call('/api/keys', json({ provider: '', apiKey: '' }));
    expect(response.status).toBe(400);
  });

  it('rejects a non-JSON body with a 400', async () => {
    const response = await call('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'request body must be valid JSON' });
  });

  it('lists metadata only', async () => {
    await saveKey('sk-mock-1234');

    const response = await call('/api/keys');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('sk-mock-1234');
    expect((JSON.parse(body) as unknown[]).length).toBe(1);
  });

  it('returns 404 from chat for an unknown key id', async () => {
    const response = await call('/api/chat', json({ keyId: crypto.randomUUID(), model: 'gpt-5-mini', prompt: 'hi' }));
    expect(response.status).toBe(404);
  });

  it('rejects chat for a key saved under an unsupported provider', async () => {
    const { id } = await saveKey('sk-mock-1234', 'made-up-provider');

    const response = await call('/api/chat', json({ keyId: id, model: 'whatever', prompt: 'hi' }));
    expect(response.status).toBe(400);
  });

  it('chat streams text using the stored openai key', async () => {
    const { id } = await saveKey('sk-mock-1234');

    let capturedAuthorization: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const url = new URL(request.url);

      if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        capturedAuthorization = request.headers.get('authorization');
        return sseResponse(OPENAI_STYLE_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'gpt-5-mini', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedAuthorization).toBe('Bearer sk-mock-1234');
  });

  it('chat routes anthropic keys through the anthropic client', async () => {
    const { id } = await saveKey('sk-ant-mock-5678', 'anthropic');

    let capturedApiKeyHeader: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const url = new URL(request.url);

      if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages' && request.method === 'POST') {
        capturedApiKeyHeader = request.headers.get('x-api-key');
        return sseResponse(ANTHROPIC_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'claude-mock', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedApiKeyHeader).toBe('sk-ant-mock-5678');
  });

  it('chat routes openrouter keys to the openrouter host', async () => {
    const { id } = await saveKey('sk-or-mock-1234', 'openrouter');

    let capturedOrigin: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const url = new URL(request.url);

      if (url.origin === 'https://openrouter.ai' && url.pathname === '/api/v1/chat/completions' && request.method === 'POST') {
        capturedOrigin = url.origin;
        return sseResponse(OPENAI_STYLE_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'openrouter-mock', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedOrigin).toBe('https://openrouter.ai');
  });

  it('chat routes openai-compatible keys to OPENAI_COMPATIBLE_BASE_URL', async () => {
    const { id } = await saveKey('sk-compat-mock-1234', 'openai-compatible');

    let capturedUrl: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);

      if (request.url === 'https://openai-compatible.test/v1/chat/completions' && request.method === 'POST') {
        capturedUrl = request.url;
        return sseResponse(OPENAI_STYLE_SSE);
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, model: 'compat-mock', prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello from the mock');
    expect(capturedUrl).toBe('https://openai-compatible.test/v1/chat/completions');
  });

  it('delete removes the key, is idempotent, and chat stops working', async () => {
    const { id } = await saveKey('sk-mock-1234');

    expect((await call(`/api/keys/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/keys/${id}`, { method: 'DELETE' })).status).toBe(204);

    const list = (await (await call('/api/keys')).json()) as { id: string }[];
    expect(list.some((key) => key.id === id)).toBe(false);
    expect((await call('/api/chat', json({ keyId: id, model: 'gpt-5-mini', prompt: 'hi' }))).status).toBe(404);
  });

  it('lists normalized models for the selected key provider', async () => {
    const { id } = await saveKey('sk-mock-1234');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input as string);

      if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/models') {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-5-mini', object: 'model' },
              { id: 'gpt-5', object: 'model' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const response = await call(`/api/models?keyId=${id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [
        { id: 'gpt-5', name: 'gpt-5' },
        { id: 'gpt-5-mini', name: 'gpt-5-mini' },
      ],
    });
  });

  it('returns 400 from models listing when keyId is missing', async () => {
    const response = await call('/api/models');
    expect(response.status).toBe(400);
  });
});
