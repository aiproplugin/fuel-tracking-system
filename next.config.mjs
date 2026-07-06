/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework to clients.
  poweredByHeader: false,
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime image needs only Node + the traced deps, not the full node_modules.
  output: "standalone",
};

export default nextConfig;
