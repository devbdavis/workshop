import { CronExpressionParser } from 'cron-parser';
import type { ScheduleConfig, SchedulePreset } from '@foundation/types';

/**
 * Convert a user-friendly ScheduleConfig into a cron expression.
 *
 * node-cron uses the standard 5-field format: minute hour day-of-month month day-of-week
 * It also supports 6-field with seconds: second minute hour day-of-month month day-of-week
 */
export function scheduleConfigToCron(config: ScheduleConfig): string {
  switch (config.preset) {
    case 'interval':
      return intervalToCron(config.intervalMinutes ?? 30);

    case 'daily':
      return dailyToCron(config.time ?? '09:00', config.daysOfWeek);

    case 'weekly':
      return weeklyToCron(config.time ?? '09:00', config.dayOfWeek ?? 1);

    case 'monthly':
      return monthlyToCron(config);

    case 'cron':
      return config.cronExpression ?? '0 9 * * *';

    default:
      return '0 9 * * *';
  }
}

/**
 * Generate a human-readable description of a schedule.
 */
export function describeSchedule(config: ScheduleConfig): string {
  switch (config.preset) {
    case 'interval': {
      const mins = config.intervalMinutes ?? 30;
      if (mins >= 60 && mins % 60 === 0) {
        const hours = mins / 60;
        return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
      }
      return `Every ${mins} minutes`;
    }

    case 'daily': {
      const time = config.time ?? '09:00';
      const days = config.daysOfWeek;
      if (!days || days.length === 0 || days.length === 7) {
        return `Daily at ${time}`;
      }
      if (arraysEqual(days, [1, 2, 3, 4, 5])) {
        return `Weekdays at ${time}`;
      }
      if (arraysEqual(days, [0, 6])) {
        return `Weekends at ${time}`;
      }
      const dayNames = days.map(dayName).join(', ');
      return `${dayNames} at ${time}`;
    }

    case 'weekly': {
      const time = config.time ?? '09:00';
      const day = dayName(config.dayOfWeek ?? 1);
      return `Every ${day} at ${time}`;
    }

    case 'monthly': {
      const time = config.time ?? '09:00';
      if (config.monthRule === 'weekday-of-month') {
        const week = config.weekOfMonth === -1 ? 'last' : ordinal(config.weekOfMonth ?? 1);
        const day = dayName(config.dayOfWeek ?? 5);
        return `${capitalize(week)} ${day} of month at ${time}`;
      }
      const dom = config.dayOfMonth ?? 1;
      if (dom === -1) return `Last day of month at ${time}`;
      return `${ordinal(dom)} of month at ${time}`;
    }

    case 'cron':
      return `Cron: ${config.cronExpression ?? '0 9 * * *'}`;

    default:
      return 'Unknown schedule';
  }
}

/**
 * Validate that a ScheduleConfig is well-formed and return any error message.
 */
export function validateScheduleConfig(config: ScheduleConfig): string | null {
  if (!config.preset) return 'preset is required';

  const validPresets: SchedulePreset[] = ['interval', 'daily', 'weekly', 'monthly', 'cron'];
  if (!validPresets.includes(config.preset)) return `Invalid preset: ${config.preset}`;

  if (config.preset === 'interval') {
    const mins = config.intervalMinutes;
    if (!mins || mins < 1) return 'intervalMinutes must be >= 1';
    if (mins > 1440) return 'intervalMinutes must be <= 1440 (24h)';
  }

  if (config.preset === 'cron') {
    if (!config.cronExpression) return 'cronExpression is required for cron preset';
  }

  if (config.time) {
    if (!/^\d{2}:\d{2}$/.test(config.time)) return 'time must be in HH:MM format';
    const [h, m] = config.time.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return 'time must be valid (00:00 - 23:59)';
  }

  if (config.daysOfWeek) {
    if (!Array.isArray(config.daysOfWeek)) return 'daysOfWeek must be an array';
    if (config.daysOfWeek.some((d) => d < 0 || d > 6)) return 'daysOfWeek values must be 0-6';
  }

  return null;
}

/**
 * Return the most recent past occurrence of a cron expression before `before`.
 * Returns null if the expression is invalid or no previous occurrence exists
 * within a reasonable lookback window.
 */
export function getLastScheduledBefore(cronExpression: string, before: Date): Date | null {
  try {
    const expr = CronExpressionParser.parse(cronExpression, { currentDate: before });
    return expr.prev().toDate();
  } catch {
    return null;
  }
}

/**
 * Return the next future occurrence of a cron expression after `after`.
 * Returns null if the expression is invalid.
 */
export function getNextScheduledAfter(cronExpression: string, after: Date): Date | null {
  try {
    const expr = CronExpressionParser.parse(cronExpression, { currentDate: after });
    return expr.next().toDate();
  } catch {
    return null;
  }
}

// --- Helpers ---

function intervalToCron(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `0 */${hours} * * *`;
  }
  return `*/${minutes} * * * *`;
}

function dailyToCron(time: string, daysOfWeek?: number[]): string {
  const [hour, minute] = time.split(':').map(Number);
  if (!daysOfWeek || daysOfWeek.length === 0 || daysOfWeek.length === 7) {
    return `${minute} ${hour} * * *`;
  }
  return `${minute} ${hour} * * ${daysOfWeek.join(',')}`;
}

function weeklyToCron(time: string, dayOfWeek: number): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

function monthlyToCron(config: ScheduleConfig): string {
  const time = config.time ?? '09:00';
  const [hour, minute] = time.split(':').map(Number);

  if (config.monthRule === 'weekday-of-month') {
    // node-cron doesn't natively support "last Friday" or "2nd Tuesday".
    // We approximate with day-of-week and handle "last" via day ranges.
    const dow = config.dayOfWeek ?? 5;
    if (config.weekOfMonth === -1) {
      // Last X of month: run on days 22-31 for the given weekday
      // This catches the last occurrence because months have at most 31 days
      return `${minute} ${hour} 22-31 * ${dow}`;
    }
    // Nth weekday: approximate with day ranges
    const week = config.weekOfMonth ?? 1;
    const startDay = (week - 1) * 7 + 1;
    const endDay = week * 7;
    return `${minute} ${hour} ${startDay}-${endDay} * ${dow}`;
  }

  // Day of month
  const dom = config.dayOfMonth ?? 1;
  if (dom === -1) {
    // Last day of month: run on 28-31, we'll need to check in handler
    // A common approximation — run on last possible days
    return `${minute} ${hour} 28-31 * *`;
  }
  return `${minute} ${hour} ${dom} * *`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayName(d: number): string {
  return DAY_NAMES[d] ?? `Day${d}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort();
  const sortedB = [...b].sort();
  return sorted.every((v, i) => v === sortedB[i]);
}
