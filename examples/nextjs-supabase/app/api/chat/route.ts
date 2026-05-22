import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { AiSdkByokAdapterError } from 'ai-sdk-byok';
import { byok } from '@/lib/byok';
import { demoUserId } from '@/lib/demo-user';
import { errorFields, logger } from '@/lib/logger';
import { isSupportedProvider, type SupportedProvider } from '@/lib/providers';

export const runtime = 'nodejs';

interface ChatRequest {
  keyId?: unknown;
  model?: unknown;
  prompt?: unknown;
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as ChatRequest;
  const keyId = textField(body.keyId);
  const requestedModel = textField(body.model);
  const prompt = textField(body.prompt);

  if (keyId.length === 0) {
    logger.warn('chat.rejected', { reason: 'missing-key' });
    return Response.json({ error: 'Choose a saved key.' }, { status: 400 });
  }

  if (prompt.length === 0 || prompt.length > 4000) {
    logger.warn('chat.rejected', { reason: 'invalid-prompt', keyId, promptLength: prompt.length });
    return Response.json({ error: 'Prompt must be between 1 and 4000 characters.' }, { status: 400 });
  }

  try {
    logger.info('chat.started', {
      userId: demoUserId,
      keyId,
      requestedModel,
      promptLength: prompt.length,
    });

    const selectedKey = await byok.keys.getById({ userId: demoUserId, keyId });

    if (!selectedKey) {
      logger.warn('chat.rejected', { reason: 'key-not-found', keyId });
      return Response.json({ error: 'Choose a saved key.' }, { status: 404 });
    }

    if (!isSupportedProvider(selectedKey.provider)) {
      logger.warn('chat.rejected', { reason: 'unsupported-provider', keyId, provider: selectedKey.provider });
      return Response.json({ error: 'Choose a supported provider key.' }, { status: 400 });
    }

    const model = createModel(selectedKey.provider, selectedKey.credentials.apiKey, requestedModel);

    logger.info('chat.stream.created', {
      keyId,
      provider: selectedKey.provider,
      model: requestedModel,
    });

    const result = streamText({
      model,
      prompt,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    if (error instanceof AiSdkByokAdapterError) {
      logger.error('chat.key-retrieval.failed', { keyId, ...errorFields(error) });
      return Response.json(
        { error: 'Supabase could not retrieve the stored key. Check the migration and server secret key.' },
        { status: 500 },
      );
    }

    logger.error('chat.failed', { keyId, requestedModel, ...errorFields(error) });
    return Response.json({ error: 'The chat request could not be completed.' }, { status: 400 });
  }
}

function createModel(provider: SupportedProvider, apiKey: string, requestedModel: string): LanguageModelV3 {
  if (requestedModel.length === 0 || requestedModel.length > 256) {
    throw new Error('Choose a model for the selected key.');
  }

  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey }).chat(requestedModel);
    case 'anthropic':
      return createAnthropic({ apiKey })(requestedModel);
    case 'deepseek':
      return createDeepSeek({ apiKey }).chat(requestedModel);
    case 'xai':
      return createXai({ apiKey }).chat(requestedModel);
    case 'groq':
      return createGroq({ apiKey })(requestedModel);
    case 'mistral':
      return createMistral({ apiKey }).chat(requestedModel);
    case 'cohere':
      return createCohere({ apiKey })(requestedModel);
    case 'openrouter':
      return createOpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        name: 'openrouter',
      }).chat(requestedModel);
    case 'openai-compatible': {
      const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL;

      if (!baseURL) {
        logger.warn('chat.provider-config.missing', { provider: 'openai-compatible', variable: 'OPENAI_COMPATIBLE_BASE_URL' });
        throw new Error('OPENAI_COMPATIBLE_BASE_URL is required for OpenAI-compatible chat');
      }

      return createOpenAI({
        apiKey,
        baseURL,
        name: 'openai-compatible',
      }).chat(requestedModel);
    }
  }
}
