import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPRITE_DIR = path.join(process.env.HOME || '/tmp', '.workshop', 'sprites');

const STYLE_BASIS =
  'Pixar-style 3D cartoon character portrait, soft lighting, ' +
  'friendly expression, solid color background, head and shoulders, ' +
  'high detail, clean render';

const HAIR_OPTIONS = ['short black hair', 'curly red hair', 'blonde ponytail', 'brown buzz cut', 'silver wavy hair'] as const;
const SHIRT_OPTIONS = ['blue hoodie', 'green flannel shirt', 'red t-shirt', 'grey turtleneck', 'yellow polo'] as const;
const ACCESSORY_OPTIONS = ['round glasses', 'baseball cap', 'headphones around neck', 'silver earring', 'no accessories'] as const;

const TRAIT_COUNT = HAIR_OPTIONS.length * SHIRT_OPTIONS.length * ACCESSORY_OPTIONS.length; // 125

const REPLICATE_MODEL = 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/** Stable numeric hash — deterministic across runs for the same input. */
export function stableHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + charCode  (djb2)
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

/** Derive a deterministic trait description from a hash value. */
export function traitsFromHash(hash: number): string {
  const idx = hash % TRAIT_COUNT;
  const hairIdx = idx % HAIR_OPTIONS.length;
  const shirtIdx = Math.floor(idx / HAIR_OPTIONS.length) % SHIRT_OPTIONS.length;
  const accIdx = Math.floor(idx / (HAIR_OPTIONS.length * SHIRT_OPTIONS.length)) % ACCESSORY_OPTIONS.length;

  return `${HAIR_OPTIONS[hairIdx]}, ${SHIRT_OPTIONS[shirtIdx]}, ${ACCESSORY_OPTIONS[accIdx]}`;
}

// ---------------------------------------------------------------------------
// SpriteGenerator
// ---------------------------------------------------------------------------

export interface SpriteGenerator {
  /** Returns the sprite filename if a cached PNG exists, otherwise undefined. */
  getSpriteFilename(sessionId: string): string | undefined;
  /** Queues generation by writing a .prompt.json sidecar if not cached/pending. */
  queueGeneration(sessionId: string): void;
  /** Exposed for testing — the resolved sprite directory path. */
  readonly spriteDir: string;
}

export function createSpriteGenerator(spriteDirOverride?: string): SpriteGenerator {
  const spriteDir = spriteDirOverride ?? SPRITE_DIR;
  const pending = new Set<string>();

  // Ensure directory exists on init
  mkdirSync(spriteDir, { recursive: true });

  function filenameFor(sessionId: string): string {
    const hash = stableHash(sessionId);
    return `char-${hash % TRAIT_COUNT}.png`;
  }

  function getSpriteFilename(sessionId: string): string | undefined {
    const name = filenameFor(sessionId);
    return existsSync(path.join(spriteDir, name)) ? name : undefined;
  }

  function queueGeneration(sessionId: string): void {
    const name = filenameFor(sessionId);
    const pngPath = path.join(spriteDir, name);
    const promptPath = pngPath.replace(/\.png$/, '.prompt.json');

    // Already cached or already queued — nothing to do
    if (existsSync(pngPath) || pending.has(name)) return;

    const hash = stableHash(sessionId);
    const traits = traitsFromHash(hash);
    const prompt = `${STYLE_BASIS}, ${traits}`;

    const sidecar = {
      sessionId,
      filename: name,
      prompt,
      model: REPLICATE_MODEL,
      createdAt: new Date().toISOString(),
    };

    writeFileSync(promptPath, JSON.stringify(sidecar, null, 2), 'utf-8');
    pending.add(name);
  }

  return { getSpriteFilename, queueGeneration, spriteDir };
}
