/**
 * `StorageService` interface. Mirrors the legacy storage abstraction:
 * `upload()` stores bytes and returns the stored-object descriptor,
 * `downloadAsString()` fetches content back by URL (used by the async
 * document processor), `delete()` removes a stored object by public ID.
 */

export interface StoredObject {
  publicId: string;
  url: string;
  originalFilename: string;
  contentType: string | null;
  fileSize: number | null;
  folder: string | null;
}

export interface StorageService {
  upload(
    bytes: Uint8Array,
    filename: string,
    contentType: string | null,
    folder: string,
  ): Promise<StoredObject>;
  downloadAsString(url: string): Promise<string>;
  delete(publicId: string): Promise<void>;
}
