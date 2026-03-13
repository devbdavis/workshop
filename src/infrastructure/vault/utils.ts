import path from 'path';

/**
 * Slugify a track name for use as a vault folder name.
 * e.g. "KMS Load Testing" -> "kms-load-testing"
 */
export function slugifyTrackName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve the vault path for a track.
 * Returns: `${vaultRoot}/Workshop/${trackSlug}`
 */
export function trackVaultPath(vaultRoot: string, trackSlug: string): string {
  return path.join(vaultRoot, 'Workshop', trackSlug);
}

/**
 * Validate that a resolved path stays within the vault root (path traversal prevention).
 * Returns the resolved absolute path, or throws if the path escapes the root.
 */
export function safePath(vaultRoot: string, relativePath: string): string {
  const resolved = path.resolve(vaultRoot, relativePath);
  if (!resolved.startsWith(path.resolve(vaultRoot))) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return resolved;
}
