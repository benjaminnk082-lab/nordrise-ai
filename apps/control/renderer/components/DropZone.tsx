'use client';
import { useCallback, useRef, useState, type ReactNode } from 'react';

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * Wraps a region of the chat UI so that any file dragged onto it is
 * captured and handed to `onFiles`. We track a depth counter because
 * dragenter/dragleave fire for child elements too — a naive boolean
 * flag flickers as you move over inner nodes.
 */
export function DropZone({ onFiles, disabled = false, children }: DropZoneProps) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  return (
    <div
      className="dropzone-wrap"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {over && (
        <div className="dropzone-overlay" aria-hidden="true">
          Slipp her for å legge ved
        </div>
      )}
    </div>
  );
}
