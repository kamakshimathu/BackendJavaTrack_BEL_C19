import { database } from '../../config/database.js';
import type { Prisma, TeamMember, TaskStatus } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/app-error.js';
import { paginationArgs } from '../../shared/request-schemas.js';
import { getProject } from '../projects/projects.service.js';
import { managers, withTeamWrite } from '../teams/team-authorization.js';
import { tryCleanupFiles } from '../../services/storage/file-cleanup.js';
import type { CreateTaskInput, UpdateTaskInput, ProjectTaskQuery, AssignedTaskQuery } from './tasks.schemas.js';

const summarySelect = { id: true, name: true } as const;
const taskSelect = {
  id: true, title: true, description: true, status: true, priority: true,
  dueDate: true, completedAt: true, projectId: true, assignedToId: true, createdById: true,
  createdAt: true, updatedAt: true,
  assignedTo: { select: summarySelect }, createdBy: { select: summarySelect },
} satisfies Prisma.TaskSelect;
type LockedTask = Prisma.TaskGetPayload<{ include: { project: { select: { teamId: true } } } }>;

const taskNotFound = () => new AppError(404, 'Task not found');
export const taskVisibility = (actorId: string): Prisma.TaskWhereInput => ({
  project: { team: { memberships: { some: { userId: actorId } } } },
});

async function validateAssignee(tx: Prisma.TransactionClient, teamId: string, assignedToId: string | null) {
  if (assignedToId === null) return;
  const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: assignedToId } } });
  if (!member) throw new AppError(422, 'Assignee must be a current member of the project team');
}

export async function withTaskWrite<T>(actorId: string, taskId: string,
  operation: (tx: Prisma.TransactionClient, task: LockedTask, member: TeamMember) => Promise<T>): Promise<T> {
  const reference = await database.task.findFirst({ where: { id: taskId, ...taskVisibility(actorId) },
    select: { project: { select: { teamId: true } } } });
  if (!reference) throw taskNotFound();
  try {
    return await withTeamWrite(reference.project.teamId, actorId, undefined, async (tx, member) => {
      const task = await tx.task.findUnique({ where: { id: taskId }, include: { project: { select: { teamId: true } } } });
      if (!task) throw taskNotFound();
      return operation(tx, task, member);
    });
  } catch (error) {
    // Membership can disappear between the first query and acquiring the lock.
    if (error instanceof AppError && error.status === 404) throw taskNotFound();
    throw error;
  }
}

export async function createTask(actorId: string, projectId: string, input: CreateTaskInput) {
  const project = await getProject(actorId, projectId);
  try {
    return await withTeamWrite(project.teamId, actorId, undefined, async (tx, member) => {
      if (input.assignedToId != null && !managers.includes(member.role)) {
        throw new AppError(403, 'Only team managers may set an assignee');
      }
      await validateAssignee(tx, project.teamId, input.assignedToId ?? null);
      return tx.task.create({ data: {
        title: input.title, description: input.description ?? null, priority: input.priority ?? 'MEDIUM',
        dueDate: input.dueDate ?? null, projectId, createdById: actorId, assignedToId: input.assignedToId ?? null,
      }, select: taskSelect });
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 404) throw new AppError(404, 'Project not found');
    throw error;
  }
}

function filteredWhere(query: ProjectTaskQuery | AssignedTaskQuery): Prisma.TaskWhereInput {
  // Treat LIKE wildcards as literal search characters; values stay parameterized.
  const search = query.search?.replace(/[\\%_]/g, '\\$&');
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(search ? { OR: [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ] } : {}),
  };
}

function orderBy(query: ProjectTaskQuery | AssignedTaskQuery): Prisma.TaskOrderByWithRelationInput[] {
  const primary: Prisma.TaskOrderByWithRelationInput = query.sortBy === 'dueDate'
    ? { dueDate: { sort: query.sortOrder, nulls: 'last' } }
    : { [query.sortBy]: query.sortOrder };
  return [primary, { id: 'asc' }];
}

async function taskPage(where: Prisma.TaskWhereInput, query: ProjectTaskQuery | AssignedTaskQuery) {
  const [tasks, total] = await database.$transaction([
    database.task.findMany({ where, select: taskSelect, orderBy: orderBy(query), ...paginationArgs(query) }),
    database.task.count({ where }),
  ]);
  return { tasks, pagination: { page: query.page, limit: query.limit, total } };
}

export async function listProjectTasks(actorId: string, projectId: string, query: ProjectTaskQuery) {
  await getProject(actorId, projectId);
  return taskPage({ ...filteredWhere(query), ...taskVisibility(actorId), projectId,
    ...(query.assignedToId !== undefined ? { assignedToId: query.assignedToId === 'null' ? null : query.assignedToId } : {}),
  }, query);
}

export function assignedToMe(actorId: string, query: AssignedTaskQuery) {
  return taskPage({ ...filteredWhere(query), ...taskVisibility(actorId), assignedToId: actorId,
    ...(query.projectId ? { projectId: query.projectId } : {}),
  }, query);
}

export async function getTask(actorId: string, taskId: string) {
  const task = await database.task.findFirst({ where: { id: taskId, ...taskVisibility(actorId) }, select: taskSelect });
  if (!task) throw taskNotFound();
  return task;
}

export function updateTask(actorId: string, taskId: string, input: UpdateTaskInput) {
  return withTaskWrite(actorId, taskId, async (tx, task, member) => {
    if (!managers.includes(member.role) && task.createdById !== actorId) {
      throw new AppError(403, 'Only team managers or the task creator may edit this task');
    }
    return tx.task.update({ where: { id: taskId }, data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    }, select: taskSelect });
  });
}

export function assignTask(actorId: string, taskId: string, assignedToId: string | null) {
  return withTaskWrite(actorId, taskId, async (tx, task, member) => {
    if (!managers.includes(member.role)) throw new AppError(403, 'Only team managers may set an assignee');
    await validateAssignee(tx, task.project.teamId, assignedToId);
    return tx.task.update({ where: { id: taskId }, data: { assignedToId }, select: taskSelect });
  });
}

export function changeTaskStatus(actorId: string, taskId: string, status: TaskStatus) {
  return withTaskWrite(actorId, taskId, async (tx, task, member) => {
    if (!managers.includes(member.role) && task.createdById !== actorId && task.assignedToId !== actorId) {
      throw new AppError(403, 'Only team managers, the creator or the assignee may change task status');
    }
    const completedAt = status === 'COMPLETED' ? task.completedAt ?? new Date() : null;
    return tx.task.update({ where: { id: taskId }, data: { status, completedAt }, select: taskSelect });
  });
}

export async function deleteTask(actorId: string, taskId: string): Promise<void> {
  const keys = await withTaskWrite(actorId, taskId, async (tx, task, member) => {
    if (!managers.includes(member.role) && task.createdById !== actorId) throw taskNotFound();
    const attachments = await tx.taskAttachment.findMany({ where: { taskId }, select: { storageKey: true }, take: 50 });
    await tx.task.delete({ where: { id: taskId } });
    return attachments.map((attachment) => attachment.storageKey);
  });
  if (keys.length) await tryCleanupFiles(keys);
}
