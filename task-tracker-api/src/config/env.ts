import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return ['postgres:', 'postgresql:'].includes(url.protocol)
        && Boolean(url.hostname) && url.pathname.length > 1;
    } catch {
      return false;
    }
  }),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().regex(/^[a-fA-F0-9]{64,}$/).refine((value) => value.length % 2 === 0
    && new Set(value.toLowerCase()).size >= 8),
  JWT_ISSUER: z.string().trim().min(1).max(200),
  JWT_AUDIENCE: z.string().trim().min(1).max(200),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  // Report field names only: validation errors must never expose credentials.
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
  throw new Error(`Invalid environment configuration: ${fields.join(', ')}. Check .env.example.`);
}

export const env = result.data;
