export interface ApiKeyCredentials {
  apiKey: string;
}

export interface KeyMetadata {
  id: string;
  userId: string;
  provider: string;
  label: string;
  keyHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveKeyInput {
  userId: string;
  provider: string;
  credentials: ApiKeyCredentials;
  label?: string;
}

export interface ListKeysInput {
  userId: string;
}

export interface GetKeyInput {
  userId: string;
  provider: string;
  label?: string;
}

export interface DeleteKeyInput {
  userId: string;
  keyId: string;
}

export interface SaveStorageInput {
  userId: string;
  provider: string;
  label: string;
  credentials: ApiKeyCredentials;
  keyHint: string;
}

export interface ListStorageInput {
  userId: string;
}

export interface GetStorageInput {
  userId: string;
  provider: string;
  label: string;
}

export interface DeleteStorageInput {
  userId: string;
  keyId: string;
}

export interface ByokStorageAdapter {
  save(input: SaveStorageInput): Promise<KeyMetadata>;
  list(input: ListStorageInput): Promise<KeyMetadata[]>;
  get(input: GetStorageInput): Promise<ApiKeyCredentials | null>;
  delete(input: DeleteStorageInput): Promise<void>;
}

export interface ByokManagerOptions {
  storage: ByokStorageAdapter;
}

export interface ByokManager {
  keys: {
    save(input: SaveKeyInput): Promise<KeyMetadata>;
    list(input: ListKeysInput): Promise<KeyMetadata[]>;
    get(input: GetKeyInput): Promise<ApiKeyCredentials | null>;
    delete(input: DeleteKeyInput): Promise<void>;
  };
}
