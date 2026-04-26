import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Nordrise Control',
  description: 'Sean desktop client',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
