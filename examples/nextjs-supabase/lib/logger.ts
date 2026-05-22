import 'server-only';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue>;

const logWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function configuredLogLevel(): LogLevel {
  const value = process.env.BYOK_EXAMPLE_LOG_LEVEL?.toLowerCase();

  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'silent') {
    return value;
  }

  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

function shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
  return logWeights[level] >= logWeights[configuredLogLevel()];
}

function writeLog(level: Exclude<LogLevel, 'silent'>, event: string, fields: LogFields = {}): void {
  if (!shouldLog(level)) {
    return;
  }

  const message = `[byok-example] ${event}`;

  if (Object.keys(fields).length > 0) {
    console[level](message, fields);
    return;
  }

  console[level](message);
}

export function errorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) {
    return { errorType: typeof error };
  }

  return {
    errorName: error.name,
    errorMessage: error.message,
  };
}

export const logger = {
  debug: (event: string, fields?: LogFields) => writeLog('debug', event, fields),
  info: (event: string, fields?: LogFields) => writeLog('info', event, fields),
  warn: (event: string, fields?: LogFields) => writeLog('warn', event, fields),
  error: (event: string, fields?: LogFields) => writeLog('error', event, fields),
};
