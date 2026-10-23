import { database } from '../../config/database.js';
import type { Prisma, TeamMember, TeamRole } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/app-error.js';

export const managers: readonly TeamRole[] = ['OWNER', 'ADMIN'];

export async function requireMembership(
  tx: Prisma.TransactionClient, teamId: string, userId: string, roles?: readonly TeamRole[],
): Promise<TeamMember> {
  const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!member) throw new AppError(404, 'Team not found');
  if (roles && !roles.includes(member.role)) throw new AppError(403, 'Insufficient team permissions');
  return member;
}

export async function lockTeam(tx: Prisma.TransactionClient, teamId: string): Promise<void> {
  // All team mutations take this lock before reading roles or changing membership.
  await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId}::uuid FOR UPDATE`;
}

export function withTeamWrite<T>(
  teamId: string, actorId: string, roles: readonly TeamRole[] | undefined,
  operation: (tx: Prisma.TransactionClient, actor: TeamMember) => Promise<T>,
): Promise<T> {
  return database.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const actor = await requireMembership(tx, teamId, actorId, roles);
    return operation(tx, actor);
  });
}
