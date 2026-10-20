import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "../common/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { accessTokenExpiresInSeconds, signAccessToken } from "../lib/jwt.js";
import {
  findUserById,
  findUserByUsernameOrEmail,
  saveUser,
  touchUserLogin,
} from "../store/prisma.js";
import { toUserResponse } from "./user.service.js";
import {
  createRefreshToken,
  revokeToken,
  rotateToken,
  verifyExpiration,
} from "./refresh-token.service.js";
import { findRefreshToken } from "../store/prisma.js";
import type {
  LoginInput,
  SignupInput,
  TokenResponse,
  UserResponse,
} from "../schemas/auth.schemas.js";

/**
 * Auth use-cases. Mirrors `AuthController` + `UserService` behavior:
 * - signup creates `LOCAL` users (`emailVerified: false`, enabled, unlocked)
 *   with a generic duplicate message (anti-enumeration)
 * - login matches `username` OR `email`, checks enabled/locked, issues an
 *   access JWT plus a rotated opaque refresh token
 */

export async function signup(input: SignupInput): Promise<UserResponse> {
  const clash =
    (await findUserByUsernameOrEmail(input.username)) ??
    (await findUserByUsernameOrEmail(input.email));
  if (clash) {
    throw new BadRequestException("Unable to register. Please check your details.");
  }
  const user = await saveUser({
    username: input.username,
    email: input.email,
    password: hashPassword(input.password),
    firstName: input.firstName,
    lastName: input.lastName,
    organizationName: input.organizationName ?? null,
    authProvider: "LOCAL",
    emailVerified: false,
    enabled: true,
    accountLocked: false,
    lastLoginAt: null,
  });
  return toUserResponse(user);
}

async function issueTokens(userId: string, username: string): Promise<TokenResponse> {
  const accessToken = await signAccessToken({ userId, username });
  const refresh = await createRefreshToken(userId);
  return {
    accessToken,
    refreshToken: refresh.token,
    tokenType: "Bearer",
    expiresIn: accessTokenExpiresInSeconds(),
  };
}

export async function login(input: LoginInput): Promise<TokenResponse> {
  const user = await findUserByUsernameOrEmail(input.usernameOrEmail);
  if (!user || !verifyPassword(input.password, user.password)) {
    throw new UnauthorizedException("Invalid credentials");
  }
  if (!user.enabled) {
    throw new ForbiddenException("Account is disabled");
  }
  if (user.accountLocked) {
    throw new ForbiddenException("Account is locked");
  }
  await touchUserLogin(user.id);
  return issueTokens(user.id, user.username);
}

export async function refresh(refreshToken: string): Promise<TokenResponse> {
  const old = await findRefreshToken(refreshToken);
  if (!old || old.revoked) {
    throw new BadRequestException("Invalid refresh token");
  }
  verifyExpiration(old);
  const next = await rotateToken(old);
  const user = await findUserById(next.userId);
  if (!user) {
    throw new BadRequestException("Invalid refresh token");
  }
  const accessToken = await signAccessToken({ userId: user.id, username: user.username });
  return {
    accessToken,
    refreshToken: next.token,
    tokenType: "Bearer",
    expiresIn: accessTokenExpiresInSeconds(),
  };
}

export async function logout(refreshToken: string): Promise<void> {
  await revokeToken(refreshToken);
}

export async function me(userId: string): Promise<UserResponse> {
  const user = await findUserById(userId);
  if (!user) {
    throw new UnauthorizedException("Unauthorized");
  }
  return toUserResponse(user);
}
