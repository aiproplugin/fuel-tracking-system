import argon2 from "argon2";

/**
 * Password hashing for the Credentials provider.
 *
 * argon2id with OWASP-recommended parameters (19 MiB memory, 2 iterations,
 * 1 lane). Hashes are self-describing, so parameters can be raised later
 * and old hashes re-hashed transparently on next successful login.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash a plaintext password with argon2id. */
export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored argon2 hash.
 * Returns false (never throws) on malformed hashes so callers always get
 * a uniform, generic failure path.
 */
export async function verifyPassword(storedHash: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, plainPassword);
  } catch {
    return false;
  }
}
