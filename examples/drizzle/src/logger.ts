const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LEVELS)[number];

function threshold(): number {
  const configured = process.env.BYOK_EXAMPLE_LOG_LEVEL ?? 'info';
  const index = LEVELS.indexOf(configured as LogLevel);
  return index === -1 ? LEVELS.indexOf('info') : index;
}

function write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  if (LEVELS.indexOf(level) < threshold()) {
    return;
  }

  const line = JSON.stringify({ level, event, ...data });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => write('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => write('error', event, data),
};
