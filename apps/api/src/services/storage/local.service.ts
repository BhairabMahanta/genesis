import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StorageService, StoredObject } from "./storage.service.js";

/**
 * Local-disk storage provider. Files live under `STORAGE_LOCAL_BASE_PATH`
 * and are addressed by `local://<publicId>` URLs so `downloadAsString()`
 * can resolve them without a database lookup.
 */

const URL_SCHEME = "local://";

export class LocalStorageService implements StorageService {
  constructor(private readonly basePath: string) {}

  private filePathFor(publicId: string): string {
    const safe = publicId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.basePath, `${safe}.bin`);
  }

  async upload(
    bytes: Uint8Array,
    filename: string,
    contentType: string | null,
    folder: string,
  ): Promise<StoredObject> {
    const publicId = randomUUID();
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.writeFile(this.filePathFor(publicId), bytes);
    return {
      publicId,
      url: `${URL_SCHEME}${publicId}`,
      originalFilename: filename,
      contentType,
      fileSize: bytes.byteLength,
      folder,
    };
  }

  async downloadAsString(url: string): Promise<string> {
    if (!url.startsWith(URL_SCHEME)) {
      throw new Error(`Unsupported storage URL: ${url}`);
    }
    const publicId = url.slice(URL_SCHEME.length);
    return fs.readFile(this.filePathFor(publicId), "utf8");
  }

  async delete(publicId: string): Promise<void> {
    await fs.rm(this.filePathFor(publicId), { force: true });
  }
}
