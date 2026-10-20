import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { BadRequestException } from "../common/errors.js";
import { revokeRefreshToken, saveRefreshToken } from "../store/prisma.js";
import type { RefreshTokenEntity } from "../store/types.js";

/**
 * Refresh-token use-cases. Mirrors `RefreshTokenService`:
 * opaque random tokens stored in `refresh_tokens`, rotated on refresh
 * (old row revoked, new row inserted with a fresh expiry).
 */

export async function createRefreshToken(userId: string): Promise<RefreshTokenEntity> {
  return saveRefreshToken({
    token: randomUUID(),
    userId,
    expiryDate: new Date(Date.now() + config.jwtRefreshTokenExpiryMs).toISOString(),
  });
}

export function verifyExpiration(token: RefreshTokenEntity): void {
  if (Number.isNaN(Date.parse(token.expiryDate)) || Date.parse(token.expiryDate) <= Date.now()) {
    throw new BadRequestException("Refresh token has expired");
  }
}

export async function rotateToken(old: RefreshTokenEntity): Promise<RefreshTokenEntity> {
  await revokeRefreshToken(old.token);
  return createRefreshToken(old.userId);
}

export async function revokeToken(token: string): Promise<void> {
  await revokeRefreshToken(token);
}
