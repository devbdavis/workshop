/**
 * Domain interface for skill scanning.
 *
 * Infrastructure provides the concrete implementation (filesystem-based).
 */
import type { Skill, SkillId } from '@foundation/types';

export interface SkillScanner {
  scanGlobalSkills(): Skill[];
  scanProjectSkills(projectRoot: string): Skill[];
  scanAll(projectRoot?: string): Skill[];
  findById(id: SkillId, projectRoot?: string): Skill | null;
}
