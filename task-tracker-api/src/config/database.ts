import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  max: 10,
  // The Prisma pg adapter expects UTC for timezone-aware timestamp conversion.
  options: '-c timezone=UTC',
  // Bound query time for startup and readiness checks.
  statement_timeout: 5_000,
  query_timeout: 6_000,
});

// ESM caches this module, so all imports share this client and connection pool.
export const database = new PrismaClient({ adapter });
