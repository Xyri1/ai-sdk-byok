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

const supportedProviderValues = new Set<string>(
  supportedProviders.map((provider) => provider.value),
);

export function isSupportedProvider(value: string): value is SupportedProvider {
  return supportedProviderValues.has(value);
}

export function getProviderLabel(value: string): string {
  return supportedProviders.find((provider) => provider.value === value)?.label ?? value;
}

export interface ModelEndpoint {
  url: string;
  headers: HeadersInit;
  providerLabel: string;
}

export function getModelEndpoint(provider: SupportedProvider, apiKey: string): ModelEndpoint {
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
      const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL;

      if (!baseURL) {
        throw new Error('OPENAI_COMPATIBLE_BASE_URL is required for OpenAI-compatible model listing');
      }

      return {
        url: `${baseURL.replace(/\/$/, '')}/models`,
        headers: bearerHeaders,
        providerLabel: 'OpenAI-compatible',
      };
    }
  }
}