import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __nordrisePrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__nordrisePrisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__nordrisePrisma = prisma;
}
