/**
 * Domain interface for vault file access.
 *
 * Infrastructure provides the concrete implementation (filesystem-based).
 */
export interface VaultReader {
  /** Read a file relative to the vault root. Returns content or null if not found. */
  readFile(filePath: string): string | null;
  /** List .md files in a directory relative to vault root. Returns relative file paths. */
  listFiles(dirPath: string): string[];
  /** Read the 3 "hot" files from Workshop/{trackSlug}/ */
  readTrackFiles(trackSlug: string): {
    overview: string | null;
    decisions: string | null;
    learnings: string | null;
  };
}
