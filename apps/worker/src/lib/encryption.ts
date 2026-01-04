import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync, createHash } from 'crypto';
import { promisify } from 'util';
import { Buffer } from 'node:buffer';

const scryptAsync = promisify(scrypt);

// ============ CONFIGURATION ============
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Get encryption key from environment
function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be set and at least 32 characters');
  }
  return key;
}

// ============ DERIVE KEY FROM PASSWORD ============
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
}

// ============ ENCRYPT ============
export async function encryptCredentials(plaintext: string): Promise<{
  encryptedData: string;
  iv: string;
  authTag: string;
  salt: string;
}> {
  const password = getEncryptionKey();
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    salt: salt.toString('hex'),
  };
}

// ============ DECRYPT ============
export function decryptCredentials(
  encryptedData: string,
  ivHex: string,
  authTagHex: string,
  saltHex?: string
): string {
  const password = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  // For backward compatibility, if no salt provided, derive key differently
  let key: Buffer;
  if (saltHex) {
    const salt = Buffer.from(saltHex, 'hex');
    // Synchronous version for simplicity in sync contexts
    key = scryptSync(password, salt, KEY_LENGTH);
  } else {
    // Legacy: use password directly (padded/truncated to 32 bytes)
    key = Buffer.alloc(KEY_LENGTH);
    Buffer.from(password).copy(key);
  }
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// ============ HASH FOR COMPARISON ============
export function hashForComparison(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ============ GENERATE SECURE RANDOM STRING ============
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

// ============ GENERATE INDEXNOW KEY ============
export function generateIndexNowKey(): string {
  // IndexNow requires 8-128 characters, hexadecimal
  return randomBytes(16).toString('hex'); // 32 hex chars
}