import { AiSdkByokSerializationError } from './errors.js';
import type { ApiKeyCredentials } from './types.js';

const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');

function throwSerializationError(): never {
  throw new AiSdkByokSerializationError('Refusing to serialize plaintext BYOK credentials');
}

export function protectCredentials(credentials: ApiKeyCredentials): ApiKeyCredentials {
  const target = { apiKey: credentials.apiKey };

  Object.defineProperties(target, {
    toJSON: {
      enumerable: false,
      value: throwSerializationError,
    },
    [Symbol.toPrimitive]: {
      enumerable: false,
      value: throwSerializationError,
    },
    [inspectSymbol]: {
      enumerable: false,
      value: () => '[ApiKeyCredentials redacted]',
    },
  });

  Object.freeze(target);

  return new Proxy(target, {
    get(proxyTarget, property, receiver) {
      if (property === 'toJSON' || property === Symbol.toPrimitive) {
        return throwSerializationError;
      }

      return Reflect.get(proxyTarget, property, receiver);
    },
  });
}
