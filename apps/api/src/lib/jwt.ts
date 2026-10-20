import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

/**
 * JWT access tokens. Mirrors `JwtTokenProvider`:
 * HS256, claims `{ sub: username, userId: UUID }`, expiry from
 * `JWT_ACCESS_TOKEN_EXPIRY` (default 15m), signed with `JWT_SECRET`.
 */

export interface AccessTokenClaims {
  userId: string;
  username: string;
}

const secretBytes = new TextEncoder().encode(config.jwtSecret);

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ userId: claims.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.username)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + Math.floor(config.jwtAccessTokenExpiryMs / 1000))
    .sign(secretBytes);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretBytes, { algorithms: ["HS256"] });
  const username = payload["sub"];
  const userId = payload["userId"];
  if (typeof username !== "string" || typeof userId !== "string") {
    throw new Error("Token is missing required claims");
  }
  return { userId, username };
}

/** Access-token TTL in seconds (the `expiresIn` field of `TokenResponse`). */
export function accessTokenExpiresInSeconds(): number {
  return Math.floor(config.jwtAccessTokenExpiryMs / 1000);
}
