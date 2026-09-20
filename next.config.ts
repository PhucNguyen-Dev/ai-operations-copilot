import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // A stray pnpm-lock.yaml in the user home makes Next infer the wrong
  // workspace root; pin it to this repo.
  outputFileTracingRoot: __dirname,
  // Isolated production artifact for builds run while the dev server is
  // up (BUILD_ANYWAY=1 npm run build → scripts/build.mjs sets this).
  distDir: process.env.NEXT_DIST_DIR || '.next',
}

export default nextConfig
