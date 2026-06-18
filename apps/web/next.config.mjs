/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Modular monolith: transpile workspace packages so source is used directly.
  transpilePackages: ['@greenfield/db', '@greenfield/money'],
  // Sensible defaults for Vercel + TS strict; harden in later cards.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
