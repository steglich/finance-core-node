/**
 * Log levels in order of severity.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger interface following structured logging principles.
 */
export interface Logger {
  /**
   * Logs a debug message.
   */
  debug(message: string, meta?: Record<string, unknown>): void;

  /**
   * Logs an informational message.
   */
  info(message: string, meta?: Record<string, unknown>): void;

  /**
   * Logs a warning message.
   */
  warn(message: string, meta?: Record<string, unknown>): void;

  /**
   * Logs an error message.
   */
  error(message: string, meta?: Record<string, unknown> | Error): void;
}

/**
 * Creates a console-based logger for development.
 */
export function createLogger(serviceName?: string): Logger {
  const prefix = serviceName ? `[${serviceName}] ` : "";

  return {
    debug(message: string, meta?: Record<string, unknown>): void {
      // eslint-disable-next-line no-console
      console.log(
        `${prefix}DEBUG: ${message}`,
        meta ? JSON.stringify(meta) : "",
      );
    },

    info(message: string, meta?: Record<string, unknown>): void {
      // eslint-disable-next-line no-console
      console.log(
        `${prefix}INFO: ${message}`,
        meta ? JSON.stringify(meta) : "",
      );
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      // eslint-disable-next-line no-console
      console.warn(
        `${prefix}WARN: ${message}`,
        meta ? JSON.stringify(meta) : "",
      );
    },

    error(message: string, meta?: Record<string, unknown> | Error): void {
      if (meta instanceof Error) {
        // eslint-disable-next-line no-console
        console.error(`${prefix}ERROR: ${message}`, {
          error: meta.message,
          stack: meta.stack,
        });
      } else {
        // eslint-disable-next-line no-console
        console.error(
          `${prefix}ERROR: ${message}`,
          meta ? JSON.stringify(meta) : "",
        );
      }
    },
  };
}
