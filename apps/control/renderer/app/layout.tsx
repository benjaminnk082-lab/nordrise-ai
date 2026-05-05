import './globals.css';
import type { ReactNode } from 'react';
import { ThemeApplier } from '../components/ThemeApplier';

export const metadata = {
  title: 'Nordrise Control',
  description: 'Sean desktop client',
};

/**
 * Inter Variable from rsms.me — small CDN, single .woff2 (~330 KB), no
 * Google-Fonts privacy footprint, supports the ss01/cv11 features the
 * design tokens reference. Falls back through Segoe UI Variable, system-ui
 * if the network is offline at first paint (Electron caches subsequent
 * loads). Bundling locally is the next step but introduces a build flow.
 */
const INTER_FONT_LINK =
  'https://rsms.me/inter/inter.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://rsms.me" crossOrigin="" />
        <link rel="stylesheet" href={INTER_FONT_LINK} />
      </head>
      <body>
        <ThemeApplier />
        {children}
      </body>
    </html>
  );
}
