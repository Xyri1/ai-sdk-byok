import { AiSdkByokAdapterError } from 'ai-sdk-byok';
import { byok } from '@/lib/byok';
import { demoUserId } from '@/lib/demo-user';
import { errorFields, logger } from '@/lib/logger';
import { getModelEndpoint, isSupportedProvider } from '@/lib/providers';

interface ModelOption {
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

export async function GET(request: Request): Promise<Response> {
  const keyId = new URL(request.url).searchParams.get('keyId')?.trim() ?? '';

  if (keyId.length === 0) {
    logger.warn('models.rejected', { reason: 'missing-key' });
    return Response.json({ error: 'Choose a saved key.' }, { status: 400 });
  }

  try {
    logger.info('models.started', { userId: demoUserId, keyId });
    const selectedKey = await byok.keys.getById({ userId: demoUserId, keyId });

    if (!selectedKey) {
      logger.warn('models.rejected', { reason: 'key-not-found', keyId });
      return Response.json({ error: 'Choose a saved key.' }, { status: 404 });
    }

    if (!isSupportedProvider(selectedKey.provider)) {
      logger.warn('models.rejected', { reason: 'unsupported-provider', keyId, provider: selectedKey.provider });
      return Response.json({ error: 'Choose a supported provider key.' }, { status: 400 });
    }

    const endpoint = getModelEndpoint(selectedKey.provider, selectedKey.credentials.apiKey);
    logger.info('models.fetch.started', {
      keyId,
      provider: selectedKey.provider,
      providerLabel: endpoint.providerLabel,
    });

    const response = await fetch(endpoint.url, {
      headers: endpoint.headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.warn('models.fetch.failed', {
        keyId,
        provider: selectedKey.provider,
        status: response.status,
      });
      return Response.json({ error: `${endpoint.providerLabel} models could not be loaded.` }, { status: 502 });
    }

    const payload = await response.json();
    const models = normalizeModels(payload);
    logger.info('models.fetch.completed', {
      keyId,
      provider: selectedKey.provider,
      count: models.length,
    });

    return Response.json({ models });
  } catch (error) {
    if (error instanceof AiSdkByokAdapterError) {
      logger.error('models.key-retrieval.failed', { keyId, ...errorFields(error) });
      return Response.json(
        { error: 'Supabase could not retrieve the selected key. Check the migration and server secret key.' },
        { status: 500 },
      );
    }

    logger.error('models.failed', { keyId, ...errorFields(error) });
    return Response.json({ error: 'Models could not be loaded for the selected key.' }, { status: 400 });
  }
}

function normalizeModels(payload: unknown): ModelOption[] {
  const records = readModelRecords(payload);
  const seen = new Set<string>();
  const models: ModelOption[] = [];

  for (const record of records) {
    const id = readString(record.id) ?? readString(record.name) ?? readString(record.model) ?? readString(record.slug);

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
