import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(1).max(100);
const password = z.string().min(12).max(128)
  .regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^a-zA-Z0-9]/);

export const registerSchema = z.strictObject({ name, email, password });
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const refreshSchema = z.strictObject({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const updateProfileSchema = z.strictObject({ name });
