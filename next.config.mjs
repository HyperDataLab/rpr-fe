/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development';
const nextConfig = {
  transpilePackages: ['@hyperdata/design-system'],
  distDir: isDev ? '.next-dev' : '.next',
};
// Next.js configuration - refreshed
export default nextConfig;
