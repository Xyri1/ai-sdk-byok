export class AiSdkByokError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AiSdkByokValidationError extends AiSdkByokError {}

export class AiSdkByokAdapterError extends AiSdkByokError {}

export class AiSdkByokSerializationError extends AiSdkByokError {}
