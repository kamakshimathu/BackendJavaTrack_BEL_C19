import { database } from '../../config/database.js';
import { AppError } from '../../shared/app-error.js';
import { paginationArgs, type Pagination, type CreateDetails, type UpdateDetails } from '../../shared/request-schemas.js';
import { profileSelect } from '../users/user-profile.js';
import { managers, requireMembership, withTeamWrite } from './team-authorization.js';

export function createTeam(actorId: string, input: CreateDetails) {
  return database.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { name: input.name, description: input.description ?? null, ownerId: actorId } });
    await tx.teamMember.create({ data: { teamId: team.id, userId: actorId, role: 'OWNER' } });
    return { ...team, role: 'OWNER' as const };
  });
}

export async function listTeams(actorId: string, pagination: Pagination) {
  const where = { userId: actorId };
  const [memberships, total] = await database.$transaction([
    database.teamMember.findMany({ where, include: { team: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }], ...paginationArgs(pagination) }),
    database.teamMember.count({ where }),
  ]);
  return { teams: memberships.map(({ team, role }) => ({ ...team, role })), pagination: { ...pagination, total } };
}

export async function getTeam(actorId: string, teamId: string) {
  const membership = await database.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: actorId } }, include: { team: true },
  });
  if (!membership) throw new AppError(404, 'Team not found');
  return { ...membership.team, role: membership.role };
}

export function updateTeam(actorId: string, teamId: string, input: UpdateDetails) {
  return withTeamWrite(teamId, actorId, managers, async (tx) =>
    tx.team.update({ where: { id: teamId }, data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    } }));
}

export function listMembers(actorId: string, teamId: string, pagination: Pagination) {
  return database.$transaction(async (tx) => {
    await requireMembership(tx, teamId, actorId);
    const members = await tx.teamMember.findMany({ where: { teamId },
      select: { id: true, teamId: true, userId: true, role: true, joinedAt: true, user: { select: profileSelect } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }], ...paginationArgs(pagination) });
    return { members, pagination: { ...pagination, total: await tx.teamMember.count({ where: { teamId } }) } };
  });
}

export function changeRole(actorId: string, teamId: string, userId: string, role: 'ADMIN' | 'MEMBER') {
  return withTeamWrite(teamId, actorId, ['OWNER'], async (tx) => {
    if (!['ADMIN', 'MEMBER'].includes(role)) throw new AppError(400, 'Invalid membership role');
    const target = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (!target) throw new AppError(404, 'Member not found');
    if (target.role === 'OWNER') throw new AppError(403, 'The team owner cannot be demoted');
    return tx.teamMember.update({ where: { id: target.id }, data: { role },
      select: { id: true, teamId: true, userId: true, role: true, joinedAt: true, user: { select: profileSelect } } });
  });
}

export function removeMember(actorId: string, teamId: string, userId: string): Promise<void> {
  return withTeamWrite(teamId, actorId, undefined, async (tx, actor) => {
    const target = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (!target) throw new AppError(404, 'Member not found');
    if (target.role === 'OWNER') throw new AppError(403, 'The team owner cannot be removed');
    const self = actor.role === 'MEMBER' && actorId === userId;
    const permitted = actor.role === 'OWNER' || self || (actor.role === 'ADMIN' && target.role === 'MEMBER');
    if (!permitted) throw new AppError(403, 'Insufficient team permissions');
    // Assignment and removal take the same team lock; clear only this team's work.
    await tx.task.updateMany({ where: { assignedToId: userId, project: { teamId } }, data: { assignedToId: null } });
    await tx.teamMember.delete({ where: { id: target.id } });
  });
}
