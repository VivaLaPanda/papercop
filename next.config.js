/** @type {import('next').NextConfig} */
const nextConfig = {
  // Remove standalone output as it may be causing issues with Vercel's expected structure
  // output: "standalone",
  trailingSlash: false, // Changed from true to false as Vercel prefers this
  swcMinify: true,
  reactStrictMode: true,
  /* Other config options */
};

module.exports = nextConfig;
