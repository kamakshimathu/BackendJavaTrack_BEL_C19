import type { Prisma } from '../../generated/prisma/client.js';

// Explicit allowlist shared by every public user response.
export const profileSelect = {
  id: true, name: true, email: true, createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{ select: typeof profileSelect }>;
