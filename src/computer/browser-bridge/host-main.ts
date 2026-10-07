#!/usr/bin/env node
/** Started by Chrome through native messaging (manifest io.dreamgraph.browser). */
import { runBrowserHostMain } from "./host.js";

void runBrowserHostMain().catch(error => {
  process.stderr.write(`DreamGraph browser host failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
