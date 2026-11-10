import { config } from "../config.js";
import { BadRequestException } from "./errors.js";

export interface MultipartFile {
  bytes: Uint8Array;
  filename: string;
  contentType: string | null;
}

/**
 * Read a single file field out of a parsed multipart body.
 *
 * Hono exposes parsed parts as `File` objects. Keeping the conversion in one
 * place means document and spreadsheet uploads share the same size limit and
 * error shape.
 */
export async function readMultipartFile(
  body: Record<string, unknown>,
  field = "file",
  maxBytes = config.maxUploadBytes,
): Promise<MultipartFile> {
  const file = body[field];
  const single = Array.isArray(file) ? file[0] : file;
  if (!(single instanceof File)) {
    throw new BadRequestException(`Missing file field "${field}" in multipart upload`);
  }
  if (single.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    throw new BadRequestException(`File exceeds the ${limitMb}MB upload limit`);
  }
  const buffer = new Uint8Array(await single.arrayBuffer());
  return {
    bytes: buffer,
    filename: single.name || "upload",
    contentType: single.type || null,
  };
}
