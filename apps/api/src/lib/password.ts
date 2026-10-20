import { createRequire } from "node:module";
import crypto from "node:crypto";

/**
 * Password hashing. Production uses `bcryptjs` (cost 12, matching the legacy
 * `BCryptPasswordEncoder(12)`); existing BCrypt hashes verify regardless of
 * cost. When `bcryptjs` is not installed (offline dev), a scrypt fallback
 * keeps the API bootable — local-only accounts created that way are marked
 * with a distinct prefix and must be re-registered once bcrypt is available.
 */

const BCRYPT_COST = 12;
const SCRYPT_PREFIX = "scrypt$v1$";

type BcryptLike = {
  hashSync(data: string, saltOrRounds: number): string;
  compareSync(data: string, hash: string): boolean;
};

let bcryptCache: BcryptLike | null | undefined;

function loadBcrypt(): BcryptLike | null {
  if (bcryptCache !== undefined) return bcryptCache;
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    bcryptCache = require("bcryptjs") as BcryptLike;
  } catch {
    bcryptCache = null;
  }
  return bcryptCache;
}

function isBcryptHash(stored: string): boolean {
  return (
    stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")
  );
}

function scryptHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${SCRYPT_PREFIX}${salt}$${derived}`;
}

function scryptVerify(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const salt = parts[2];
  const expected = parts[3];
  if (!salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hashPassword(password: string): string {
  const bcrypt = loadBcrypt();
  if (bcrypt) return bcrypt.hashSync(password, BCRYPT_COST);
  return scryptHash(password);
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith(SCRYPT_PREFIX)) return scryptVerify(password, storedHash);
  if (isBcryptHash(storedHash)) {
    const bcrypt = loadBcrypt();
    if (!bcrypt) {
      throw new Error(
        "Stored password uses BCrypt but bcryptjs is not installed. " +
          "Install dependencies to enable login with migrated accounts.",
      );
    }
    return bcrypt.compareSync(password, storedHash);
  }
  return false;
}

/** True when the runtime can verify production (BCrypt) password hashes. */
export function canVerifyBcrypt(): boolean {
  return loadBcrypt() !== null;
}
