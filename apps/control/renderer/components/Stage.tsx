'use client';
import type { ReactNode } from 'react';

export function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="stage">
      <div className="blob blob-purple" />
      <div className="blob blob-pink" />
      <div className="blob blob-blue" />
      <div className="stage-content">{children}</div>
    </div>
  );
}
