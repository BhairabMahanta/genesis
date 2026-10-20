/**
 * Document response DTO. Mirrors the legacy `DocumentResponse` fields
 * (upload returns 201 "Document uploaded successfully", status updates
 * echo the updated document).
 */

export interface DocumentResponse {
  id: string;
  name: string;
  orderIndex: number;
  status: "UPLOADED" | "IMPORTED" | "ANNOTATING" | "COMPLETE";
  progress: number | null;
  workspaceId: string;
  storedFileUrl: string | null;
  tokenStartIndex: number | null;
  tokenEndIndex: number | null;
  processingStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
  fileSize: number | null;
}
