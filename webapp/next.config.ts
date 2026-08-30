import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // The served snapshot is frozen for the life of the process (validated at
  // startup via snapshot_meta), so per-URL rendered HTML is deterministic.
  // compress doubles cold SSR CPU; the render cache below absorbs repeats.
  compress: false,
};

export default nextConfig;
