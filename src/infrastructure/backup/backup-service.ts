import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  createWriteStream,
  createReadStream,
  statSync,
  openSync,
  readSync,
  closeSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createBrotliDecompress, constants as zlibConstants } from 'node:zlib';
import { getDatabase } from '@infrastructure/persistence/database.js';
import {
  buildHeader,
  createDecryptStream,
  createEncryptStream,
  deriveKey,
  parseHeader,
  AUTH_TAG_BYTES,
  HEADER_BYTES,
} from './backup-format.js';
import {
  buildBackupFileName,
  DEFAULT_RETENTION,
  isWeeklyDay,
  listBackups,
  pruneBackups,
  type BackupKind,
  type PruneResult,
  type RetentionPolicy,
} from './retention.js';

export interface BackupSources {
  /** Path to the workshop sqlite db. Defaults to ~/.workshop/workshop.db. */
  workshopDbPath?: string;
  /** Claude config directory. Defaults to ~/.claude. */
  claudeDir?: string;
}

export interface BackupRunOptions {
  destination: string;
  passphrase: string;
  sources?: BackupSources;
  /** Override the "now" clock used for filename + weekly detection (tests). */
  now?: Date;
  /** Override retention policy (tests). */
  retention?: RetentionPolicy;
  /** Force a specific kind — otherwise inferred from day-of-week. */
  kind?: BackupKind;
}

export interface BackupResult {
  filePath: string;
  kind: BackupKind;
  bytes: number;
  uncompressedBytes: number;
  ratio: number;
  durationMs: number;
  prune: PruneResult;
}

export interface RestoreOptions {
  source: string;
  passphrase: string;
  destinationDir: string;
}

const BROTLI_OPTIONS = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
  },
};

/**
 * Stage sources into a temporary directory. We do a proper SQLite online
 * backup via better-sqlite3 rather than copying the live file — that avoids
 * capturing WAL-in-flight state and means the backup is a valid standalone
 * database.
 */
async function stageSources(sources: BackupSources): Promise<{ stageDir: string; manifest: StageManifest }> {
  const stageDir = mkdtempSync(path.join(tmpdir(), 'workshop-backup-'));
  const manifest: StageManifest = { files: [] };

  const workshopDbPath = sources.workshopDbPath ?? path.join(homedir(), '.workshop', 'workshop.db');
  if (existsSync(workshopDbPath)) {
    const dbDest = path.join(stageDir, 'workshop.db');
    const db = getDatabase();
    // better-sqlite3's .backup() does a proper online backup that survives WAL.
    // It writes a single self-contained file — no shm/wal artefacts.
    await db.backup(dbDest);
    manifest.files.push({ source: workshopDbPath, staged: 'workshop.db' });
  }

  const claudeDir = sources.claudeDir ?? path.join(homedir(), '.claude');
  const claudeFiles: Array<[string, string]> = [
    [path.join(claudeDir, 'settings.json'), 'claude/settings.json'],
    [path.join(claudeDir, 'settings.local.json'), 'claude/settings.local.json'],
    [path.join(claudeDir, 'hooks-config.toml'), 'claude/hooks-config.toml'],
  ];
  for (const [source, staged] of claudeFiles) {
    if (!existsSync(source)) continue;
    const dest = path.join(stageDir, staged);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    manifest.files.push({ source, staged });
  }

  // Record the manifest so a future restore can reconstitute paths.
  writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { stageDir, manifest };
}

interface StageManifest {
  files: Array<{ source: string; staged: string }>;
}

/**
 * Pipe: tar(stageDir) -> brotli(max) -> AES-256-GCM -> destFile (header + ciphertext + authTag trailer).
 */
async function encryptArchive(
  stageDir: string,
  destFile: string,
  passphrase: string,
): Promise<{ bytes: number; uncompressedBytes: number }> {
  const { headerBytes, salt, iv } = buildHeader();
  const key = deriveKey(passphrase, salt);
  const { stream: cipher, getAuthTag } = createEncryptStream(key, iv);

  const out = createWriteStream(destFile);
  await new Promise<void>((resolve, reject) => {
    out.write(headerBytes, (err) => (err ? reject(err) : resolve()));
  });

  // Spawn `tar -cf -` on the stage dir. Using `-C stageDir .` produces relative
  // paths, which is what we want for restore.
  const tarProc = spawn('tar', ['-cf', '-', '-C', stageDir, '.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let tarStderr = '';
  tarProc.stderr.on('data', (chunk: Buffer) => { tarStderr += chunk.toString(); });

  let uncompressed = 0;
  tarProc.stdout.on('data', (chunk: Buffer) => { uncompressed += chunk.length; });

  const brotli = createBrotliCompress(BROTLI_OPTIONS);

  // Chain the pipeline. Stop before `out` so we can append the auth tag.
  const pipelinePromise = pipeline(tarProc.stdout, brotli, cipher);

  // Manually pipe cipher -> out (don't end out on cipher end — we still need to write authTag).
  cipher.on('data', (chunk: Buffer) => out.write(chunk));

  const tarExit = new Promise<void>((resolve, reject) => {
    tarProc.on('error', reject);
    tarProc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}: ${tarStderr.trim()}`));
    });
  });

  try {
    await Promise.all([tarExit, pipelinePromise]);
  } catch (err) {
    out.destroy();
    throw err;
  }

  // cipher.final() has already run inside the pipeline — the auth tag is ready.
  const authTag = getAuthTag();
  await new Promise<void>((resolve, reject) => {
    out.write(authTag, (err) => (err ? reject(err) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    out.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });

  return { bytes: statSync(destFile).size, uncompressedBytes: uncompressed };
}

export async function runBackup(options: BackupRunOptions): Promise<BackupResult> {
  if (!options.destination) throw new Error('Backup destination is not configured');
  if (!options.passphrase) throw new Error('Backup passphrase is not configured');

  mkdirSync(options.destination, { recursive: true });

  const now = options.now ?? new Date();
  const kind: BackupKind = options.kind ?? (isWeeklyDay(now) ? 'weekly' : 'daily');
  const fileName = buildBackupFileName(kind, now);
  const destFile = path.join(options.destination, fileName);

  const startedAt = Date.now();
  const { stageDir } = await stageSources(options.sources ?? {});

  try {
    const { bytes, uncompressedBytes } = await encryptArchive(stageDir, destFile, options.passphrase);
    const ratio = uncompressedBytes > 0 ? bytes / uncompressedBytes : 0;
    const prune = pruneBackups(options.destination, options.retention ?? DEFAULT_RETENTION);

    return {
      filePath: destFile,
      kind,
      bytes,
      uncompressedBytes,
      ratio,
      durationMs: Date.now() - startedAt,
      prune,
    };
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

/**
 * Restore an encrypted backup. Writes the original staged files into the
 * given destination directory (retaining the internal layout — `workshop.db`,
 * `claude/…`, `manifest.json`). We intentionally don't overwrite live
 * locations — the user can inspect first and move files into place.
 */
export async function restoreBackup(options: RestoreOptions): Promise<void> {
  const fd = openSync(options.source, 'r');
  let header: Buffer;
  let authTag: Buffer;
  try {
    const totalSize = statSync(options.source).size;
    if (totalSize < HEADER_BYTES + AUTH_TAG_BYTES) {
      throw new Error('Backup file truncated');
    }
    header = Buffer.alloc(HEADER_BYTES);
    readSync(fd, header, 0, HEADER_BYTES, 0);
    authTag = Buffer.alloc(AUTH_TAG_BYTES);
    readSync(fd, authTag, 0, AUTH_TAG_BYTES, totalSize - AUTH_TAG_BYTES);
  } finally {
    closeSync(fd);
  }

  const { salt, iv } = parseHeader(header);
  const key = deriveKey(options.passphrase, salt);
  const decipher = createDecryptStream(key, iv, authTag);

  const totalSize = statSync(options.source).size;
  const cipherStart = HEADER_BYTES;
  const cipherEnd = totalSize - AUTH_TAG_BYTES - 1;
  const cipherStream = createReadStream(options.source, { start: cipherStart, end: cipherEnd });

  mkdirSync(options.destinationDir, { recursive: true });

  const brotli = createBrotliDecompress();
  const tarProc = spawn('tar', ['-xf', '-', '-C', options.destinationDir], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let tarStderr = '';
  tarProc.stderr.on('data', (chunk: Buffer) => { tarStderr += chunk.toString(); });

  const tarExit = new Promise<void>((resolve, reject) => {
    tarProc.on('error', reject);
    tarProc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}: ${tarStderr.trim()}`));
    });
  });

  await Promise.all([
    pipeline(cipherStream, decipher, brotli, tarProc.stdin),
    tarExit,
  ]);
}

export { listBackups, pruneBackups };
