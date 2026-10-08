import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'SBSSS Result ERP',
  description: 'Shri Bhartiya Sanskriti Shiksha Sansthan — school result management',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'SBSSS ERP', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#17233B', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}<PwaRegister /></body>
    </html>
  );
}
