import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // A stray pnpm-lock.yaml in the user home makes Next infer the wrong
  // workspace root; pin it to this repo.
  outputFileTracingRoot: __dirname,
}

export default nextConfig
