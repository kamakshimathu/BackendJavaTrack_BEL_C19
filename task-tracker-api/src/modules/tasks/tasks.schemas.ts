import { z } from 'zod';
import { paginationSchema } from '../../shared/request-schemas.js';

const title = z.string().trim().min(1).max(200);
const description = z.string().trim().max(5000).nullable();
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const status = z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED']);
const dueDate = z.iso.datetime({ offset: true }).refine((value) => !value.startsWith('0000'))
  .transform((value) => new Date(value)).nullable();

export const taskParamsSchema = z.strictObject({ taskId: z.uuid() });
export const createTaskSchema = z.strictObject({
  title, description: description.optional(), priority: priority.optional(),
  dueDate: dueDate.optional(), assignedToId: z.uuid().nullable().optional(),
});
export const updateTaskSchema = z.strictObject({
  title: title.optional(), description: description.optional(), priority: priority.optional(), dueDate: dueDate.optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined));
export const assignTaskSchema = z.strictObject({ assignedToId: z.uuid().nullable() });
export const taskStatusSchema = z.strictObject({ status });

const filters = {
  status: status.optional(), priority: priority.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'dueDate', 'priority', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
};
export const projectTaskQuerySchema = paginationSchema.extend({
  ...filters, assignedToId: z.union([z.uuid(), z.literal('null')]).optional(),
});
export const assignedTaskQuerySchema = paginationSchema.extend({ ...filters, projectId: z.uuid().optional() });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ProjectTaskQuery = z.infer<typeof projectTaskQuerySchema>;
export type AssignedTaskQuery = z.infer<typeof assignedTaskQuerySchema>;
