import { z } from 'zod';

export const paginationSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;
export const paginationArgs = ({ page, limit }: Pagination) => ({ skip: (page - 1) * limit, take: limit });
export const emptyQuerySchema = z.strictObject({});
export const teamParamsSchema = z.strictObject({ teamId: z.uuid() });
export const projectParamsSchema = z.strictObject({ projectId: z.uuid() });
export const memberParamsSchema = z.strictObject({ teamId: z.uuid(), userId: z.uuid() });
export const invitationParamsSchema = z.strictObject({ invitationId: z.uuid() });

const name = z.string().trim().min(1).max(100);
const description = z.string().trim().max(2000).nullable().optional();
export const createDetailsSchema = z.strictObject({ name, description });
export const updateDetailsSchema = z.strictObject({ name: name.optional(), description })
  .refine((value) => value.name !== undefined || value.description !== undefined);
export type CreateDetails = z.infer<typeof createDetailsSchema>;
export type UpdateDetails = z.infer<typeof updateDetailsSchema>;
export const roleSchema = z.strictObject({ role: z.enum(['ADMIN', 'MEMBER']) });
export const inviteSchema = z.strictObject({ email: z.string().trim().toLowerCase().email().max(254) });
