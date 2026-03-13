import { describe, it, expect } from 'vitest';
import {
  scheduleConfigToCron,
  describeSchedule,
  validateScheduleConfig,
} from '@application/scheduler/cron-utils';
import type { ScheduleConfig } from '@foundation/types';

describe('cron-utils', () => {
  describe('scheduleConfigToCron', () => {
    it('converts interval (30 minutes) to cron', () => {
      const config: ScheduleConfig = { preset: 'interval', intervalMinutes: 30 };
      expect(scheduleConfigToCron(config)).toBe('*/30 * * * *');
    });

    it('converts interval (every hour) to cron', () => {
      const config: ScheduleConfig = { preset: 'interval', intervalMinutes: 60 };
      expect(scheduleConfigToCron(config)).toBe('0 */1 * * *');
    });

    it('converts interval (every 2 hours) to cron', () => {
      const config: ScheduleConfig = { preset: 'interval', intervalMinutes: 120 };
      expect(scheduleConfigToCron(config)).toBe('0 */2 * * *');
    });

    it('converts interval (15 minutes) to cron', () => {
      const config: ScheduleConfig = { preset: 'interval', intervalMinutes: 15 };
      expect(scheduleConfigToCron(config)).toBe('*/15 * * * *');
    });

    it('defaults interval to 30 minutes', () => {
      const config: ScheduleConfig = { preset: 'interval' };
      expect(scheduleConfigToCron(config)).toBe('*/30 * * * *');
    });

    it('converts daily at 09:00 to cron', () => {
      const config: ScheduleConfig = { preset: 'daily', time: '09:00' };
      expect(scheduleConfigToCron(config)).toBe('0 9 * * *');
    });

    it('converts daily with specific days (weekdays) to cron', () => {
      const config: ScheduleConfig = { preset: 'daily', time: '09:00', daysOfWeek: [1, 2, 3, 4, 5] };
      expect(scheduleConfigToCron(config)).toBe('0 9 * * 1,2,3,4,5');
    });

    it('converts daily at 14:30 on Mon/Wed/Fri', () => {
      const config: ScheduleConfig = { preset: 'daily', time: '14:30', daysOfWeek: [1, 3, 5] };
      expect(scheduleConfigToCron(config)).toBe('30 14 * * 1,3,5');
    });

    it('defaults daily time to 09:00', () => {
      const config: ScheduleConfig = { preset: 'daily' };
      expect(scheduleConfigToCron(config)).toBe('0 9 * * *');
    });

    it('converts weekly on Monday at 09:00', () => {
      const config: ScheduleConfig = { preset: 'weekly', time: '09:00', dayOfWeek: 1 };
      expect(scheduleConfigToCron(config)).toBe('0 9 * * 1');
    });

    it('converts weekly on Friday at 17:00', () => {
      const config: ScheduleConfig = { preset: 'weekly', time: '17:00', dayOfWeek: 5 };
      expect(scheduleConfigToCron(config)).toBe('0 17 * * 5');
    });

    it('converts monthly day-of-month (15th at 09:00)', () => {
      const config: ScheduleConfig = {
        preset: 'monthly',
        time: '09:00',
        monthRule: 'day-of-month',
        dayOfMonth: 15,
      };
      expect(scheduleConfigToCron(config)).toBe('0 9 15 * *');
    });

    it('converts monthly last day (approximate)', () => {
      const config: ScheduleConfig = {
        preset: 'monthly',
        time: '09:00',
        monthRule: 'day-of-month',
        dayOfMonth: -1,
      };
      expect(scheduleConfigToCron(config)).toBe('0 9 28-31 * *');
    });

    it('converts monthly last Friday', () => {
      const config: ScheduleConfig = {
        preset: 'monthly',
        time: '09:00',
        monthRule: 'weekday-of-month',
        weekOfMonth: -1,
        dayOfWeek: 5,
      };
      expect(scheduleConfigToCron(config)).toBe('0 9 22-31 * 5');
    });

    it('converts monthly 2nd Tuesday', () => {
      const config: ScheduleConfig = {
        preset: 'monthly',
        time: '10:00',
        monthRule: 'weekday-of-month',
        weekOfMonth: 2,
        dayOfWeek: 2,
      };
      expect(scheduleConfigToCron(config)).toBe('0 10 8-14 * 2');
    });

    it('passes through raw cron expression', () => {
      const config: ScheduleConfig = { preset: 'cron', cronExpression: '*/5 * * * *' };
      expect(scheduleConfigToCron(config)).toBe('*/5 * * * *');
    });

    it('defaults cron expression to daily at 09:00', () => {
      const config: ScheduleConfig = { preset: 'cron' };
      expect(scheduleConfigToCron(config)).toBe('0 9 * * *');
    });
  });

  describe('describeSchedule', () => {
    it('describes 30-minute interval', () => {
      expect(describeSchedule({ preset: 'interval', intervalMinutes: 30 })).toBe('Every 30 minutes');
    });

    it('describes hourly interval', () => {
      expect(describeSchedule({ preset: 'interval', intervalMinutes: 60 })).toBe('Every hour');
    });

    it('describes multi-hour interval', () => {
      expect(describeSchedule({ preset: 'interval', intervalMinutes: 180 })).toBe('Every 3 hours');
    });

    it('describes daily at time', () => {
      expect(describeSchedule({ preset: 'daily', time: '09:00' })).toBe('Daily at 09:00');
    });

    it('describes weekdays at time', () => {
      expect(describeSchedule({ preset: 'daily', time: '09:00', daysOfWeek: [1, 2, 3, 4, 5] })).toBe(
        'Weekdays at 09:00',
      );
    });

    it('describes weekends at time', () => {
      expect(describeSchedule({ preset: 'daily', time: '10:00', daysOfWeek: [0, 6] })).toBe(
        'Weekends at 10:00',
      );
    });

    it('describes specific days', () => {
      expect(describeSchedule({ preset: 'daily', time: '09:00', daysOfWeek: [1, 3, 5] })).toBe(
        'Mon, Wed, Fri at 09:00',
      );
    });

    it('describes weekly schedule', () => {
      expect(describeSchedule({ preset: 'weekly', time: '09:00', dayOfWeek: 1 })).toBe(
        'Every Mon at 09:00',
      );
    });

    it('describes monthly day-of-month', () => {
      expect(
        describeSchedule({ preset: 'monthly', time: '09:00', monthRule: 'day-of-month', dayOfMonth: 15 }),
      ).toBe('15th of month at 09:00');
    });

    it('describes monthly last day', () => {
      expect(
        describeSchedule({ preset: 'monthly', time: '09:00', monthRule: 'day-of-month', dayOfMonth: -1 }),
      ).toBe('Last day of month at 09:00');
    });

    it('describes monthly last Friday', () => {
      expect(
        describeSchedule({
          preset: 'monthly',
          time: '09:00',
          monthRule: 'weekday-of-month',
          weekOfMonth: -1,
          dayOfWeek: 5,
        }),
      ).toBe('Last Fri of month at 09:00');
    });

    it('describes monthly 1st Tuesday', () => {
      expect(
        describeSchedule({
          preset: 'monthly',
          time: '09:00',
          monthRule: 'weekday-of-month',
          weekOfMonth: 1,
          dayOfWeek: 2,
        }),
      ).toBe('1st Tue of month at 09:00');
    });

    it('describes raw cron expression', () => {
      expect(describeSchedule({ preset: 'cron', cronExpression: '*/5 * * * *' })).toBe(
        'Cron: */5 * * * *',
      );
    });
  });

  describe('validateScheduleConfig', () => {
    it('returns null for valid interval config', () => {
      expect(validateScheduleConfig({ preset: 'interval', intervalMinutes: 30 })).toBeNull();
    });

    it('returns error for interval < 1', () => {
      expect(validateScheduleConfig({ preset: 'interval', intervalMinutes: 0 })).toBe(
        'intervalMinutes must be >= 1',
      );
    });

    it('returns error for interval > 1440', () => {
      expect(validateScheduleConfig({ preset: 'interval', intervalMinutes: 2000 })).toBe(
        'intervalMinutes must be <= 1440 (24h)',
      );
    });

    it('returns error for missing intervalMinutes', () => {
      expect(validateScheduleConfig({ preset: 'interval' })).toBe('intervalMinutes must be >= 1');
    });

    it('returns null for valid daily config', () => {
      expect(validateScheduleConfig({ preset: 'daily', time: '09:00' })).toBeNull();
    });

    it('returns error for invalid time format', () => {
      expect(validateScheduleConfig({ preset: 'daily', time: '9:00' })).toBe(
        'time must be in HH:MM format',
      );
    });

    it('returns error for out-of-range time', () => {
      expect(validateScheduleConfig({ preset: 'daily', time: '25:00' })).toBe(
        'time must be valid (00:00 - 23:59)',
      );
    });

    it('returns error for invalid day in daysOfWeek', () => {
      expect(validateScheduleConfig({ preset: 'daily', time: '09:00', daysOfWeek: [1, 7] })).toBe(
        'daysOfWeek values must be 0-6',
      );
    });

    it('returns null for valid cron config', () => {
      expect(validateScheduleConfig({ preset: 'cron', cronExpression: '0 9 * * *' })).toBeNull();
    });

    it('returns error for cron without expression', () => {
      expect(validateScheduleConfig({ preset: 'cron' })).toBe(
        'cronExpression is required for cron preset',
      );
    });

    it('returns error for missing preset', () => {
      expect(validateScheduleConfig({} as ScheduleConfig)).toBe('preset is required');
    });

    it('returns error for invalid preset', () => {
      expect(validateScheduleConfig({ preset: 'invalid' as any })).toBe('Invalid preset: invalid');
    });

    it('returns null for valid weekly config', () => {
      expect(validateScheduleConfig({ preset: 'weekly', time: '09:00', dayOfWeek: 5 })).toBeNull();
    });

    it('returns null for valid monthly config', () => {
      expect(
        validateScheduleConfig({
          preset: 'monthly',
          time: '09:00',
          monthRule: 'day-of-month',
          dayOfMonth: 15,
        }),
      ).toBeNull();
    });
  });
});
