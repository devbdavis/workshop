/**
 * Vitest global setup — runs once before any test file.
 *
 * Ensures tests never touch the production or dev databases by
 * clearing WORKSHOP_DB_PATH. Individual test files each set their
 * own temp DB path before importing the database module.
 */

export function setup() {
  const dbPath = process.env.WORKSHOP_DB_PATH || '';

  // Warn if the env pointed at a real database
  const forbidden = ['.workshop/workshop.db', 'projects/workshop/workshop.db'];
  for (const pattern of forbidden) {
    if (dbPath.includes(pattern)) {
      console.warn(
        `\n⚠️  WORKSHOP_DB_PATH was set to a real database (${dbPath}). Clearing it for test isolation.\n`,
      );
    }
  }

  // Always clear so test files control their own DB path
  delete process.env.WORKSHOP_DB_PATH;
  process.env.WORKSHOP_TEST_MODE = '1';
}
