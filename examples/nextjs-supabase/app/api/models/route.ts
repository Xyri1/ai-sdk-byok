import { AiSdkByokAdapterError } from 'ai-sdk-byok';
import { byok } from '@/lib/byok';
import { demoUserId } from '@/lib/demo-user';
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
    return Response.json({ error: 'Choose a saved key.' }, { status: 400 });
  }

  try {
    const keys = await byok.keys.list({ userId: demoUserId });
    const selectedKey = keys.find((key) => key.id === keyId);

    if (!selectedKey) {
      return Response.json({ error: 'Choose a saved key.' }, { status: 404 });
    }

    if (!isSupportedProvider(selectedKey.provider)) {
      return Response.json({ error: 'Choose a supported provider key.' }, { status: 400 });
    }

    const credentials = await byok.keys.get({
      userId: demoUserId,
      provider: selectedKey.provider,
      label: selectedKey.label,
    });

    if (credentials === null) {
      return Response.json({ error: 'The selected key could not be retrieved.' }, { status: 404 });
    }

    const endpoint = getModelEndpoint(selectedKey.provider, credentials.apiKey);
    const response = await fetch(endpoint.url, {
      headers: endpoint.headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      return Response.json({ error: `${endpoint.providerLabel} models could not be loaded.` }, { status: 502 });
    }

    const payload = await response.json();
    const models = normalizeModels(payload);

    return Response.json({ models });
  } catch (error) {
    if (error instanceof AiSdkByokAdapterError) {
      return Response.json(
        { error: 'Supabase could not retrieve the selected key. Check the migration and server secret key.' },
        { status: 500 },
      );
    }

    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    throw error;
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