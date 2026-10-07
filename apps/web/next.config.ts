import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.ROSIE_NEXT_DIST_DIR || ".next",
  transpilePackages: ["@rosie/types"],
  poweredByHeader: false,
  experimental: { cpus: 1, useTypeScriptCli: false },
};
export default config;
