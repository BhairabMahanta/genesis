import type { NextConfig } from "next";

// Docker images consume the standalone bundle. On Windows accounts without
// SeCreateSymbolicLinkPrivilege Next's standalone tracing fails with EPERM;
// `NEXT_STANDALONE=false next build` skips that bundle for local verification.
const standalone = process.env.NEXT_STANDALONE !== "false";

const nextConfig: NextConfig = {
  output: standalone ? "standalone" : undefined,
  experimental: {
    serverActions: {
      // Document uploads (TXT / CoNLL-2012 / XMI corpora) flow through the
      // uploadDocumentAction Server Action and routinely exceed Next's default
      // 1 MB request body limit. Raise it to accommodate real annotation files.
      // Keep this in sync with the backend's Spring multipart max-file-size.
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
