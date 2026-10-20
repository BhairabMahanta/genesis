import { serve } from "@hono/node-server";
import { config } from "./config.js";
import app from "./app.js";

/**
 * Process entry point. The Hono app itself lives in `app.ts` so integration
 * tests can exercise routes without binding a port.
 */

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Genesis TypeScript API listening on http://localhost:${info.port}`);
});

export default app;
