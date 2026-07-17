import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker, { type Env } from '../src/index';

const workerEnv = env as unknown as Env;

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

async function saveKey(apiKey: string): Promise<{ id: string }> {
  const response = await call('/api/keys', json({ provider: 'openai', apiKey }));
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

  it('lists metadata only', async () => {
    await saveKey('sk-mock-1234');

    const response = await call('/api/keys');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('sk-mock-1234');
    expect((JSON.parse(body) as unknown[]).length).toBe(1);
  });

  it('returns 404 from chat for an unknown key id', async () => {
    const response = await call('/api/chat', json({ keyId: crypto.randomUUID(), prompt: 'hi' }));
    expect(response.status).toBe(404);
  });

  it('chat uses the stored key against the provider', async () => {
    const { id } = await saveKey('sk-mock-1234');

    let capturedAuthorization: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const url = new URL(request.url);

      if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        capturedAuthorization = request.headers.get('authorization');
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: 1752710400,
            model: 'gpt-5-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from the mock' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    });

    const response = await call('/api/chat', json({ keyId: id, prompt: 'Say hello' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'Hello from the mock' });
    expect(capturedAuthorization).toBe('Bearer sk-mock-1234');
  });

  it('delete removes the key, is idempotent, and chat stops working', async () => {
    const { id } = await saveKey('sk-mock-1234');

    expect((await call(`/api/keys/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/keys/${id}`, { method: 'DELETE' })).status).toBe(204);

    const list = (await (await call('/api/keys')).json()) as unknown[];
    expect(list).toEqual([]);
    expect((await call('/api/chat', json({ keyId: id, prompt: 'hi' }))).status).toBe(404);
  });
});
