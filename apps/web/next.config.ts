import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.ROSIE_NEXT_DIST_DIR || ".next",
  transpilePackages: ["@rosie/types"],
  poweredByHeader: false,
  allowedDevOrigins: process.env.ROSIE_ORIGIN
    ? [new URL(process.env.ROSIE_ORIGIN).hostname]
    : undefined,
  experimental: { cpus: 1, useTypeScriptCli: false },
};
export default config;
