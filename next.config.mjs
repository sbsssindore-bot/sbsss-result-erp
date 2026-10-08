/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    outputFileTracingIncludes: {
      '/api/report-pdf': ['./node_modules/@sparticuz/chromium/bin/**', './public/sbsss-logo.png'],
      '/admin/reports/preview': ['./public/sbsss-logo.png'],
    },
    serverActions: { bodySizeLimit: '8mb' },
  },
  async headers() {
    return [
      { source: '/(.*)', headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ] },
      { source: '/sw.js', headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ] },
    ];
  },
};
export default nextConfig;
