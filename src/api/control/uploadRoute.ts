import { Router } from 'express';
import multer from 'multer';
import { createId } from '@paralleldrive/cuid2';
import { fileTypeFromBuffer } from 'file-type';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../logger.js';
import { makeRequireControlToken } from './auth.js';

const FORBIDDEN_MIME_PREFIXES = ['application/x-msdownload', 'application/x-executable', 'application/x-dosexec'];

export interface UploadRouterDeps {
  inboxDir: string;
  allowedTokens: readonly string[];
  maxFileSizeBytes: number;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 200) || 'file';
}

export function makeControlUploadRouter(deps: UploadRouterDeps): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxFileSizeBytes, files: 1 },
  });

  r.post(
    '/upload',
    makeRequireControlToken(deps.allowedTokens),
    upload.single('file'),
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'no_file' });
        return;
      }
      const sniff = await fileTypeFromBuffer(req.file.buffer);
      if (sniff && FORBIDDEN_MIME_PREFIXES.some((p) => sniff.mime.startsWith(p))) {
        res.status(415).json({ error: 'forbidden_mime', detected: sniff.mime });
        return;
      }
      const cuid = createId();
      const safeName = sanitize(req.file.originalname);
      const fileId = cuid;
      const onDiskName = `${cuid}-${safeName}`;
      const fullPath = join(deps.inboxDir, onDiskName);

      try {
        await mkdir(deps.inboxDir, { recursive: true });
        await writeFile(fullPath, req.file.buffer);
      } catch (err) {
        logger.error({ err }, 'control.upload write failed');
        res.status(500).json({ error: 'write_failed' });
        return;
      }

      logger.info(
        { fileId, size: req.file.size, mime: sniff?.mime ?? req.file.mimetype },
        'control.upload',
      );
      res.json({ fileId, workspacePath: fullPath, filename: safeName, size: req.file.size });
    },
  );

  // multer's payload-too-large produces an error; surface as 413
  r.use((err: any, _req: any, res: any, next: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'file_too_large' });
      return;
    }
    next(err);
  });

  return r;
}
