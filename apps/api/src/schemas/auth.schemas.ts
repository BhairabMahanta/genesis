import { z } from "zod";

/**
 * Auth request validation. Bounds mirror the legacy `SignupRequest` /
 * `LoginRequest` / `RefreshTokenRequest` annotations (`@Size(3,50)` etc.).
 *
 * Note: the migration doc lists "password min 8 chars", but the Java
 * `@Size(min=6)` annotation and the frontend `signupSchema` both enforce
 * min 6 — parity follows the Java backend (min 6) so current frontend
 * forms keep working.
 */

export const signupSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  organizationName: z.string().max(255).optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationName?: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}
