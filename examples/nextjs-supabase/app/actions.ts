'use server';

import {
  AiSdkByokAdapterError,
  AiSdkByokValidationError,
} from 'ai-sdk-byok';
import { revalidatePath } from 'next/cache';
import { byok } from '@/lib/byok';
import { demoUserId } from '@/lib/demo-user';
import { errorFields, logger } from '@/lib/logger';
import { isSupportedProvider } from '@/lib/providers';

export interface KeyActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
}

const idleState: KeyActionState = { status: 'idle', message: '' };

function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function actionError(error: unknown): KeyActionState {
  if (error instanceof AiSdkByokValidationError) {
    return { status: 'error', message: error.message };
  }

  if (error instanceof AiSdkByokAdapterError) {
    return {
      status: 'error',
      message: 'Supabase could not complete the key operation. Check the migration and server secret key.',
    };
  }

  return { status: 'error', message: 'The key operation failed.' };
}

export async function saveKeyAction(
  _previousState: KeyActionState = idleState,
  formData: FormData,
): Promise<KeyActionState> {
  try {
    const provider = fieldValue(formData, 'provider');
    const label = fieldValue(formData, 'label');
    const apiKey = fieldValue(formData, 'apiKey');

    if (!isSupportedProvider(provider)) {
      logger.warn('key.save.rejected', { reason: 'unsupported-provider', provider });
      return { status: 'error', message: 'Choose a supported provider.' };
    }

    logger.info('key.save.started', {
      userId: demoUserId,
      provider,
      label: label.length > 0 ? label : 'default',
      hasApiKey: apiKey.length > 0,
    });

    const metadata = await byok.keys.save({
      userId: demoUserId,
      provider,
      label: label.length > 0 ? label : undefined,
      credentials: { apiKey },
    });

    logger.info('key.save.completed', {
      userId: metadata.userId,
      keyId: metadata.id,
      provider: metadata.provider,
      label: metadata.label,
      keyHint: metadata.keyHint,
    });

    revalidatePath('/');
    return { status: 'success', message: 'Key saved. Metadata refreshed.' };
  } catch (error) {
    logger.error('key.save.failed', errorFields(error));
    return actionError(error);
  }
}

export async function deleteKeyAction(formData: FormData): Promise<void> {
  const keyId = fieldValue(formData, 'keyId');

  try {
    logger.info('key.delete.started', { userId: demoUserId, keyId });
    await byok.keys.delete({ userId: demoUserId, keyId });
    logger.info('key.delete.completed', { userId: demoUserId, keyId });
    revalidatePath('/');
  } catch (error) {
    if (!(error instanceof AiSdkByokAdapterError || error instanceof AiSdkByokValidationError)) {
      throw error;
    }

    logger.error('key.delete.failed', { keyId, ...errorFields(error) });
  }
}
