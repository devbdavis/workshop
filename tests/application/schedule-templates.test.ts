import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { describeSchedule, validateScheduleConfig } from '@application/scheduler/cron-utils';
import type { BundledScheduleDefinition } from '@application/scheduler/schedule-importer';

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/schedules');
const REPO_ROOT = path.resolve(__dirname, '../..');
const FILES = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));

function loadTemplate(fileName: string): BundledScheduleDefinition {
  const raw = fs.readFileSync(path.join(TEMPLATES_DIR, fileName), 'utf-8');
  return JSON.parse(raw) as BundledScheduleDefinition;
}

describe('schedule templates', () => {
  it('have unique names across files', () => {
    const names = FILES.map((f) => loadTemplate(f).name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each(FILES)('%s', (fileName) => {
    const def = loadTemplate(fileName);

    it('has a non-empty name and taskPrompt', () => {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.taskPrompt).toBe('string');
      expect(def.taskPrompt.length).toBeGreaterThan(0);
    });

    it('has a valid scheduleConfig', () => {
      expect(validateScheduleConfig(def.scheduleConfig)).toBeNull();
      expect(describeSchedule(def.scheduleConfig)).not.toBe('');
    });

    it('points scriptFile at a file that exists, if set', () => {
      if (def.scriptFile) {
        expect(fs.existsSync(path.join(REPO_ROOT, def.scriptFile))).toBe(true);
      }
    });
  });
});
