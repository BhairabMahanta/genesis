import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { config } from "../../config.js";
import type { StorageService, StoredObject } from "./storage.service.js";

/**
 * Cloudinary storage provider. Reads `CLOUDINARY_CLOUD_NAME`,
 * `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. `fromEnv()` returns `null`
 * when the SDK is missing or the credentials are not configured so
 * `getStorage()` can fall back to local disk with a warning.
 */

interface CloudinarySdk {
  v2: {
    config(options: Record<string, unknown>): void;
    uploader: {
      upload_stream(
        options: Record<string, unknown>,
        callback: (err: unknown, result?: { public_id: string; secure_url: string; resource_type?: string; format?: string; bytes?: number }) => void,
      ): { end(data: Uint8Array): void };
      destroy(publicId: string, callback: (err: unknown) => void): void;
    };
  };
}

function loadSdk(): CloudinarySdk | null {
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("cloudinary") as CloudinarySdk;
  } catch {
    return null;
  }
}

export class CloudinaryStorageService implements StorageService {
  private constructor(private readonly sdk: CloudinarySdk) {}

  static fromEnv(): CloudinaryStorageService | null {
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
      return null;
    }
    const sdk = loadSdk();
    if (!sdk) return null;
    sdk.v2.config({
      cloud_name: config.cloudinaryCloudName,
      api_key: config.cloudinaryApiKey,
      api_secret: config.cloudinaryApiSecret,
    });
    return new CloudinaryStorageService(sdk);
  }

  upload(
    bytes: Uint8Array,
    filename: string,
    contentType: string | null,
    folder: string,
  ): Promise<StoredObject> {
    const publicId = randomUUID();
    return new Promise((resolve, reject) => {
      const stream = this.sdk.v2.uploader.upload_stream(
        { public_id: publicId, folder, resource_type: "raw" },
        (err, result) => {
          if (err || !result) {
            reject(err instanceof Error ? err : new Error("Cloudinary upload failed"));
            return;
          }
          resolve({
            publicId: result.public_id,
            url: result.secure_url,
            originalFilename: filename,
            contentType,
            fileSize: result.bytes ?? bytes.byteLength,
            folder,
          });
        },
      );
      stream.end(bytes);
    });
  }

  async downloadAsString(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download stored file (status ${res.status})`);
    }
    return res.text();
  }

  destroy(publicId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sdk.v2.uploader.destroy(publicId, (err) => {
        if (err) reject(err instanceof Error ? err : new Error("Cloudinary delete failed"));
        else resolve();
      });
    });
  }

  async delete(publicId: string): Promise<void> {
    await this.destroy(publicId);
  }
}
