import { database } from '../../config/database.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/app-error.js';
import { paginationArgs, type Pagination } from '../../shared/request-schemas.js';
import { getTask, taskVisibility, withTaskWrite } from '../tasks/tasks.service.js';
import { managers } from '../teams/team-authorization.js';

const commentSelect = {
  id: true, taskId: true, authorId: true, content: true, createdAt: true, updatedAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.TaskCommentSelect;

export function createComment(actorId: string, taskId: string, content: string) {
  return withTaskWrite(actorId, taskId, async (tx) =>
    tx.taskComment.create({ data: { taskId, authorId: actorId, content }, select: commentSelect }));
}

export async function listComments(actorId: string, taskId: string, pagination: Pagination) {
  await getTask(actorId, taskId);
  const where = { taskId, task: taskVisibility(actorId) };
  const [comments, total] = await database.$transaction([
    database.taskComment.findMany({ where, select: commentSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...paginationArgs(pagination) }),
    database.taskComment.count({ where }),
  ]);
  return { comments, pagination: { ...pagination, total } };
}

async function commentReference(actorId: string, commentId: string) {
  const comment = await database.taskComment.findFirst({ where: { id: commentId, task: taskVisibility(actorId) }, select: { taskId: true } });
  if (!comment) throw new AppError(404, 'Comment not found');
  return comment;
}

export async function updateComment(actorId: string, commentId: string, content: string) {
  const reference = await commentReference(actorId, commentId);
  try {
    return await withTaskWrite(actorId, reference.taskId, async (tx) => {
      const comment = await tx.taskComment.findUnique({ where: { id: commentId } });
      if (!comment) throw new AppError(404, 'Comment not found');
      if (comment.authorId !== actorId) throw new AppError(403, 'Only the author may edit this comment');
      return tx.taskComment.update({ where: { id: commentId }, data: { content }, select: commentSelect });
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 404) throw new AppError(404, 'Comment not found');
    throw error;
  }
}

export async function deleteComment(actorId: string, commentId: string): Promise<void> {
  const reference = await commentReference(actorId, commentId);
  try {
    await withTaskWrite(actorId, reference.taskId, async (tx, _task, member) => {
      const comment = await tx.taskComment.findUnique({ where: { id: commentId } });
      if (!comment) throw new AppError(404, 'Comment not found');
      if (comment.authorId !== actorId && !managers.includes(member.role)) throw new AppError(403, 'Cannot delete this comment');
      await tx.taskComment.delete({ where: { id: commentId } });
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 404) throw new AppError(404, 'Comment not found');
    throw error;
  }
}
