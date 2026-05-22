import { protectCredentials } from './credential-proxy.js';
import {
  validateDeleteInput,
  validateGetByIdInput,
  validateGetInput,
  validateListInput,
  validateSaveInput,
} from './validation.js';
import type { ByokManager, ByokManagerOptions } from './types.js';

export function createByokManager(options: ByokManagerOptions): ByokManager {
  return {
    keys: {
      async save(input) {
        const validated = validateSaveInput(input);
        return options.storage.save(validated);
      },

      async list(input) {
        const validated = validateListInput(input);
        return options.storage.list(validated);
      },

      async get(input) {
        const validated = validateGetInput(input);
        const credentials = await options.storage.get(validated);

        if (credentials === null) {
          return null;
        }

        return protectCredentials(credentials);
      },

      async getById(input) {
        const validated = validateGetByIdInput(input);
        const record = await options.storage.getById(validated);

        if (record === null) {
          return null;
        }

        return {
          ...record,
          credentials: protectCredentials(record.credentials),
        };
      },

      async delete(input) {
        const validated = validateDeleteInput(input);
        await options.storage.delete(validated);
      },
    },
  };
}
