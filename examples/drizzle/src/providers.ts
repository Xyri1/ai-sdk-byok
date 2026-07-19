import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModelV4 } from '@ai-sdk/provider';

export const supportedProviders = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xai', label: 'xAI' },
  { value: 'groq', label: 'Groq' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
] as const;

export type SupportedProvider = (typeof supportedProviders)[number]['value'];

const supportedProviderValues = new Set<string>(supportedProviders.map((provider) => provider.value));

export function isSupportedProvider(value: string): value is SupportedProvider {
  return supportedProviderValues.has(value);
}

export interface ModelEndpoint {
  url: string;
  headers: Record<string, string>;
  providerLabel: string;
}

export function getModelEndpoint(
  provider: SupportedProvider,
  apiKey: string,
  openaiCompatibleBaseURL?: string,
): ModelEndpoint {
  const bearerHeaders = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  switch (provider) {
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: bearerHeaders, providerLabel: 'OpenAI' };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        headers: {
          Accept: 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
        },
        providerLabel: 'Anthropic',
      };
    case 'deepseek':
      return { url: 'https://api.deepseek.com/models', headers: bearerHeaders, providerLabel: 'DeepSeek' };
    case 'xai':
      return { url: 'https://api.x.ai/v1/models', headers: bearerHeaders, providerLabel: 'xAI' };
    case 'groq':
      return { url: 'https://api.groq.com/openai/v1/models', headers: bearerHeaders, providerLabel: 'Groq' };
    case 'mistral':
      return { url: 'https://api.mistral.ai/v1/models', headers: bearerHeaders, providerLabel: 'Mistral' };
    case 'cohere':
      return { url: 'https://api.cohere.com/v2/models', headers: bearerHeaders, providerLabel: 'Cohere' };
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/models', headers: bearerHeaders, providerLabel: 'OpenRouter' };
    case 'openai-compatible': {
      if (!openaiCompatibleBaseURL) {
        throw new Error('A base URL is required for OpenAI-compatible model listing');
      }

      return {
        url: `${openaiCompatibleBaseURL.replace(/\/$/, '')}/models`,
        headers: bearerHeaders,
        providerLabel: 'OpenAI-compatible',
      };
    }
  }
}

export function createModel(
  provider: SupportedProvider,
  apiKey: string,
  modelId: string,
  openaiCompatibleBaseURL?: string,
): LanguageModelV4 {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey }).chat(modelId);
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId);
    case 'deepseek':
      return createDeepSeek({ apiKey }).chat(modelId);
    case 'xai':
      return createXai({ apiKey }).chat(modelId);
    case 'groq':
      return createGroq({ apiKey })(modelId);
    case 'mistral':
      return createMistral({ apiKey }).chat(modelId);
    case 'cohere':
      return createCohere({ apiKey })(modelId);
    case 'openrouter':
      return createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', name: 'openrouter' }).chat(modelId);
    case 'openai-compatible': {
      if (!openaiCompatibleBaseURL) {
        throw new Error('A base URL is required for OpenAI-compatible chat');
      }

      return createOpenAI({ apiKey, baseURL: openaiCompatibleBaseURL, name: 'openai-compatible' }).chat(modelId);
    }
  }
}

export interface ModelOption {
  id: string;
  name: string;
}

interface ModelRecord {
  id?: unknown;
  name?: unknown;
  model?: unknown;
  slug?: unknown;
  display_name?: unknown;
  displayName?: unknown;
}

export function normalizeModels(payload: unknown): ModelOption[] {
  const records = readModelRecords(payload);
  const seen = new Set<string>();
  const models: ModelOption[] = [];

  for (const record of records) {
    const id =
      readString(record.id) ?? readString(record.name) ?? readString(record.model) ?? readString(record.slug);

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    models.push({
      id,
      name: readString(record.display_name) ?? readString(record.displayName) ?? readString(record.name) ?? id,
    });
  }

  return models.sort((first, second) => first.name.localeCompare(second.name));
}

function readModelRecords(payload: unknown): ModelRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isModelRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const models = payload.models;
  if (Array.isArray(models)) {
    return models.filter(isModelRecord);
  }

  const data = payload.data;
  if (Array.isArray(data)) {
    return data.filter(isModelRecord);
  }

  return [];
}

function isModelRecord(value: unknown): value is ModelRecord {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
