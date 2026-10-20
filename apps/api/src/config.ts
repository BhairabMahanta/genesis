/**
 * Typed environment reader. Mirrors the legacy `application.properties`
 * (plus `env.example`) so the TS backend accepts the same variables.
 *
 * Duration values accept Spring `Duration` style: `15m`, `7d`, `900s`,
 * `3600000`, or ISO-8601 `PT15M`. Bare numbers are milliseconds.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Environment variable ${name} must be set`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** Parse a Spring-style Duration string into milliseconds. */
export function parseDurationToMs(input: string, fallbackMs: number): number {
  const raw = (input ?? "").trim();
  if (raw === "") return fallbackMs;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = raw.match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (m) {
    const n = Number(m[1]);
    switch (m[2].toLowerCase()) {
      case "ms":
        return n;
      case "s":
        return n * 1000;
      case "m":
        return n * 60 * 1000;
      case "h":
        return n * 60 * 60 * 1000;
      case "d":
        return n * 24 * 60 * 60 * 1000;
    }
  }
  // ISO-8601 subset: PT15M, P7D, PT30S
  const iso = raw.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (iso && (iso[1] ?? iso[2] ?? iso[3] ?? iso[4])) {
    const d = Number(iso[1] ?? 0);
    const h = Number(iso[2] ?? 0);
    const min = Number(iso[3] ?? 0);
    const s = Number(iso[4] ?? 0);
    return ((d * 24 + h) * 60 + min) * 60 * 1000 + s * 1000;
  }
  throw new Error(`Invalid duration value: "${input}"`);
}

const isProd = process.env["NODE_ENV"] === "production";

const jwtSecret = isProd
  ? required("JWT_SECRET")
  : (process.env["JWT_SECRET"] ??
    "dev-only-insecure-secret-min-32-chars-long!!");

if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters");
}

const corsRaw = optional(
  "CORS_ALLOWED_ORIGINS",
  isProd ? "" : "http://localhost:3000,http://127.0.0.1:3000",
);
const corsAllowedOrigins = corsRaw
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

if (isProd && corsAllowedOrigins.length === 0) {
  throw new Error("CORS_ALLOWED_ORIGINS must be set in production");
}

export const config = {
  nodeEnv: process.env["NODE_ENV"] ?? "development",
  isProd,
  port: Number(process.env["PORT"] ?? 8080),
  databaseUrl: process.env["DATABASE_URL"] ?? process.env["DB_URL"] ?? "",
  jwtSecret,
  jwtAccessTokenExpiryMs: parseDurationToMs(
    process.env["JWT_ACCESS_TOKEN_EXPIRY"] ?? "15m",
    15 * 60 * 1000,
  ),
  jwtRefreshTokenExpiryMs: parseDurationToMs(
    process.env["JWT_REFRESH_TOKEN_EXPIRY"] ?? "7d",
    7 * 24 * 60 * 60 * 1000,
  ),
  corsAllowedOrigins,
  // Default mirrors the Java `StorageProperties` fallback (`cloudinary`).
  // getStorage() falls back to local disk with a warning when the
  // Cloudinary SDK is not installed or not configured.
  storageProvider: (process.env["STORAGE_PROVIDER"] ??
    "cloudinary") as "local" | "cloudinary",
  storageRetainSource: (process.env["STORAGE_RETAIN_SOURCE"] ?? "true") === "true",
  storageLocalBasePath:
    process.env["STORAGE_LOCAL_BASE_PATH"] ?? "./data/uploads",
  cloudinaryCloudName: process.env["CLOUDINARY_CLOUD_NAME"] ?? "",
  cloudinaryApiKey: process.env["CLOUDINARY_API_KEY"] ?? "",
  cloudinaryApiSecret: process.env["CLOUDINARY_API_SECRET"] ?? "",
  /** Matches Spring `spring.servlet.multipart.max-file-size=50MB`. */
  maxUploadBytes: 50 * 1024 * 1024,
} as const;

export type AppConfig = typeof config;
