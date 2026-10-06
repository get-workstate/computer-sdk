#!/usr/bin/env node
import "./quiet.js";
import { startServer } from "./start.js";

startServer().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
