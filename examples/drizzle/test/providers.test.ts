import { describe, expect, it } from 'vitest';
import { getModelEndpoint, isSupportedProvider, normalizeModels } from '../src/providers';

describe('getModelEndpoint', () => {
  it('builds the openai-compatible models URL from the stored base URL', () => {
    const endpoint = getModelEndpoint('openai-compatible', 'sk-x', 'https://llm.internal/v1/');
    expect(endpoint.url).toBe('https://llm.internal/v1/models');
  });

  it('throws when openai-compatible has no base URL', () => {
    expect(() => getModelEndpoint('openai-compatible', 'sk-x')).toThrow(
      'A base URL is required for OpenAI-compatible model listing',
    );
  });

  it('uses x-api-key headers for anthropic', () => {
    const endpoint = getModelEndpoint('anthropic', 'sk-a');
    expect(endpoint.headers).toMatchObject({ 'x-api-key': 'sk-a' });
  });
});

describe('isSupportedProvider', () => {
  it('accepts listed providers and rejects unknown values', () => {
    expect(isSupportedProvider('openrouter')).toBe(true);
    expect(isSupportedProvider('openai-compatible')).toBe(true);
    expect(isSupportedProvider('bedrock')).toBe(false);
  });
});

describe('normalizeModels', () => {
  it('dedupes and sorts records from data arrays', () => {
    expect(normalizeModels({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })).toEqual([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b' },
    ]);
  });
});
