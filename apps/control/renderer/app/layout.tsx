import './globals.css';
import type { ReactNode } from 'react';
import { ThemeApplier } from '../components/ThemeApplier';

export const metadata = {
  title: 'Nordrise Control',
  description: 'Sean desktop client',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb" data-theme="dark">
      <body>
        <ThemeApplier />
        {children}
      </body>
    </html>
  );
}
