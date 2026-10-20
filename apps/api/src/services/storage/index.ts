import { config } from "../../config.js";
import { CloudinaryStorageService } from "./cloudinary.service.js";
import { LocalStorageService } from "./local.service.js";
import type { StorageService } from "./storage.service.js";

/**
 * Storage provider selector. `STORAGE_PROVIDER` picks the backend
 * (`cloudinary` | `local`); a misconfigured Cloudinary falls back to
 * local disk with a warning instead of crashing the upload path.
 */

let cached: StorageService | undefined;

export function getStorage(): StorageService {
  if (cached) return cached;
  if (config.storageProvider === "local") {
    cached = new LocalStorageService(config.storageLocalBasePath);
    return cached;
  }
  const cloud = CloudinaryStorageService.fromEnv();
  if (!cloud) {
    console.warn(
      "Cloudinary is not installed or not configured; falling back to local disk storage.",
    );
    cached = new LocalStorageService(config.storageLocalBasePath);
    return cached;
  }
  cached = cloud;
  return cached;
}
