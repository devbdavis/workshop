import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Transform } from 'node:stream';

// Encrypted backup layout:
//
//   [magic: 6 bytes "WSBAK\0"] [version: 1 byte] [salt: 32 bytes] [iv: 12 bytes]
//   [ciphertext: N bytes]
//   [authTag: 16 bytes]  // GCM trailer
//
// The auth tag is only known after cipher.final(), so it's written as a trailer
// rather than inside the header. Decryption reads the header, streams ciphertext
// up to (fileSize - 16), then applies the trailing 16 bytes as the auth tag.

export const MAGIC: Buffer = Buffer.from('WSBAK\0', 'binary');
export const FORMAT_VERSION: number = 1;
export const SALT_BYTES: number = 32;
export const IV_BYTES: number = 12;
export const AUTH_TAG_BYTES: number = 16;
export const HEADER_BYTES: number = MAGIC.length + 1 + SALT_BYTES + IV_BYTES;

// Scrypt cost — Node defaults are N=16384,r=8,p=1. That's fine for a local
// per-user backup, and it keeps the passphrase unlock under 100ms on any
// reasonable machine.
const SCRYPT_KEYLEN: number = 32;

export interface EncryptionHeader {
  salt: Buffer;
  iv: Buffer;
}

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, SCRYPT_KEYLEN);
}

export function buildHeader(): { headerBytes: Buffer; salt: Buffer; iv: Buffer } {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const headerBytes = Buffer.concat([
    MAGIC,
    Buffer.from([FORMAT_VERSION]),
    salt,
    iv,
  ]);
  return { headerBytes, salt, iv };
}

export function parseHeader(buf: Buffer): EncryptionHeader {
  if (buf.length < HEADER_BYTES) {
    throw new Error(`Backup header too short: ${buf.length} < ${HEADER_BYTES}`);
  }
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Backup magic bytes do not match — not a Workshop backup');
  }
  const version = buf.readUInt8(MAGIC.length);
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${version}`);
  }
  const saltStart = MAGIC.length + 1;
  const ivStart = saltStart + SALT_BYTES;
  return {
    salt: Buffer.from(buf.subarray(saltStart, saltStart + SALT_BYTES)),
    iv: Buffer.from(buf.subarray(ivStart, ivStart + IV_BYTES)),
  };
}

export interface CipherStream {
  stream: Transform;
  getAuthTag(): Buffer;
}

export function createEncryptStream(key: Buffer, iv: Buffer): CipherStream {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return {
    stream: cipher,
    getAuthTag: () => cipher.getAuthTag(),
  };
}

export function createDecryptStream(key: Buffer, iv: Buffer, authTag: Buffer): Transform {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher;
}
