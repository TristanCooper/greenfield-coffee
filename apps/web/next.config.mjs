/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Modular monolith: transpile workspace packages so source is used directly.
  transpilePackages: ['@greenfield/db', '@greenfield/money'],
  // The @greenfield/db package uses ESM-style imports with explicit
  // `.js` extensions in source (e.g. `import { ... } from './rls.js'`)
  // — that matches Node ESM's expectation when the package's TS
  // source compiles to `.js` files. Next.js's webpack doesn't
  // rewrite `.js` → `.ts` by default, so we tell it to treat the
  // `@greenfield/db` source tree as a single resolution scope.
  //
  // Without this, every import from @greenfield/db into apps/web
  // fails at build time with "Can't resolve './rls.js'" — because
  // webpack looks for `rls.js` on disk, which doesn't exist (only
  // `rls.ts` does).
  //
  // `extensionAlias` is documented at
  // https://webpack.js.org/configuration/resolve/#resolveextensionalias
  // — it tells webpack "when you see `.js`, also try `.ts`".
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
  // Sensible defaults for Vercel + TS strict; harden in later cards.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
