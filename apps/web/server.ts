import { createServer } from "node:http";
import next from "next";
import { loadConfig } from "./src/server/config";
import { api } from "./src/server/http/api";
import { createRuntime } from "./src/server/runtime";

const config = loadConfig(),
  runtime = createRuntime(config);
if (!(await runtime.repo.ready()))
  throw new Error("Import the catalog before starting the application.");
const app = next({
  dev: process.env.NODE_ENV !== "production",
  dir: process.cwd(),
  hostname: config.host,
  port: config.port,
});
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  if (!(await api(req, res, runtime))) await handle(req, res);
});
runtime.gateway.attach(
  server,
  process.env.NODE_ENV !== "production" ? app.getUpgradeHandler() : undefined,
);
await runtime.automations.configure();
await runtime.interactions.configure();
server.listen(config.port, config.host, () =>
  console.log(`Rosie application listening on port ${config.port}`),
);
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.on(event, () => {
    runtime.interactions.close();
    runtime.gateway.close();
    runtime.automations.close();
    server.close(() => {
      void runtime.automations
        .settled()
        .then(() => runtime.repo.db.$disconnect())
        .then(() => process.exit(0));
    });
  });
