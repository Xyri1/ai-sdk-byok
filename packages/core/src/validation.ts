import { AiSdkByokValidationError } from './errors.js';
import type {
  ApiKeyCredentials,
  DeleteKeyInput,
  GetKeyByIdInput,
  GetKeyInput,
  ListKeysInput,
  SaveKeyInput,
} from './types.js';

const DEFAULT_LABEL = 'default';

function assertRecord(value: unknown, name: string): asserts value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiSdkByokValidationError(`${name} must be an object`);
  }
}

function assertString(value: unknown, name: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string') {
    throw new AiSdkByokValidationError(`${name} must be a string`);
  }

  if (value.trim().length === 0) {
    throw new AiSdkByokValidationError(`${name} must be a non-empty string`);
  }

  if (value.length > maxLength) {
    throw new AiSdkByokValidationError(`${name} must be at most ${maxLength} characters`);
  }
}

export function normalizeLabel(label: unknown): string {
  if (label === undefined) {
    return DEFAULT_LABEL;
  }

  assertString(label, 'label', 128);
  return label;
}

export function validateCredentials(credentials: unknown): ApiKeyCredentials {
  if (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials)) {
    throw new AiSdkByokValidationError('credentials must be exactly { apiKey: string }');
  }

  const keys = Reflect.ownKeys(credentials);
  if (keys.length !== 1 || keys[0] !== 'apiKey') {
    throw new AiSdkByokValidationError('credentials must be exactly { apiKey: string }');
  }

  const apiKey = (credentials as { apiKey?: unknown }).apiKey;
  assertString(apiKey, 'apiKey', 8192);

  return { apiKey };
}

export function deriveKeyHint(credentials: ApiKeyCredentials): string {
  return credentials.apiKey.slice(-4);
}

export function validateSaveInput(input: SaveKeyInput) {
  assertRecord(input, 'input');
  assertString(input.userId, 'userId', 256);
  assertString(input.provider, 'provider', 128);

  const label = normalizeLabel(input.label);
  const credentials = validateCredentials(input.credentials);

  return {
    userId: input.userId,
    provider: input.provider,
    label,
    credentials,
    keyHint: deriveKeyHint(credentials),
  };
}

export function validateListInput(input: ListKeysInput) {
  assertRecord(input, 'input');
  assertString(input.userId, 'userId', 256);

  return {
    userId: input.userId,
  };
}

export function validateGetInput(input: GetKeyInput) {
  assertRecord(input, 'input');
  assertString(input.userId, 'userId', 256);
  assertString(input.provider, 'provider', 128);

  return {
    userId: input.userId,
    provider: input.provider,
    label: normalizeLabel(input.label),
  };
}

export function validateGetByIdInput(input: GetKeyByIdInput) {
  assertRecord(input, 'input');
  assertString(input.userId, 'userId', 256);
  assertString(input.keyId, 'keyId', 128);

  return {
    userId: input.userId,
    keyId: input.keyId,
  };
}

export function validateDeleteInput(input: DeleteKeyInput) {
  assertRecord(input, 'input');
  assertString(input.userId, 'userId', 256);
  assertString(input.keyId, 'keyId', 128);

  return {
    userId: input.userId,
    keyId: input.keyId,
  };
}
