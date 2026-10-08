export default (phase: string) => ({
  ...(phase === 'phase-development-server' ? {} : { output: 'export', assetPrefix: './' }),
  images: { unoptimized: true },
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
});
