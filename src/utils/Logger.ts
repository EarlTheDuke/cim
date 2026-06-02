/**
 * Simple structured logger for the simulation.
 * 
 * In the future this can be extended with log levels, filtering,
 * or sending logs to an inspector panel.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: any;
}

export class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 500;

  constructor(private prefix: string = 'Sim') {}

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message: `[${this.prefix}] ${message}`,
      data,
    };

    this.logs.push(entry);

    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // For now, output to console with some coloring
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    if (data !== undefined) {
      console[consoleMethod](entry.message, data);
    } else {
      console[consoleMethod](entry.message);
    }
  }

  getLogs(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.logs.filter(log => log.level === level);
    }
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }
}

// Default simulation logger
export const simLogger = new Logger('CitySim');
