import { database } from '../../config/database.js';
import { Prisma, type TeamInvitation } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/app-error.js';
import { paginationArgs, type Pagination } from '../../shared/request-schemas.js';
import { lockTeam, managers, withTeamWrite } from '../teams/team-authorization.js';

function effectiveInvitation(invitation: TeamInvitation, now: Date) {
  return { ...invitation, status: invitation.status === 'PENDING' && invitation.expiresAt <= now
    ? 'EXPIRED' as const : invitation.status };
}

export async function createInvitation(actorId: string, teamId: string, email: string) {
  try {
    return await withTeamWrite(teamId, actorId, managers, async (tx) => {
      const invitedUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (!invitedUser) throw new AppError(404, 'Registered user not found');
      const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: invitedUser.id } } });
      if (member) throw new AppError(409, 'User is already a team member');
      const now = new Date();
      // Expired PENDING rows release the partial unique index only on writes.
      await tx.teamInvitation.updateMany({
        where: { teamId, invitedEmail: email, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' },
      });
      if (await tx.teamInvitation.findFirst({ where: { teamId, invitedEmail: email, status: 'PENDING' } })) {
        throw new AppError(409, 'A pending invitation already exists');
      }
      return tx.teamInvitation.create({ data: {
        teamId, invitedEmail: email, invitedById: actorId,
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'A pending invitation already exists');
    }
    throw error;
  }
}

export async function listInvitations(actorId: string, pagination: Pagination) {
  const user = await database.user.findUnique({ where: { id: actorId }, select: { email: true } });
  if (!user) throw new AppError(401, 'Authentication required');
  const where = { invitedEmail: user.email };
  const [invitations, total] = await database.$transaction([
    database.teamInvitation.findMany({ where, include: { team: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...paginationArgs(pagination) }),
    database.teamInvitation.count({ where }),
  ]);
  const now = new Date();
  return { invitations: invitations.map((invitation) => ({
    ...effectiveInvitation(invitation, now), team: invitation.team,
  })), pagination: { ...pagination, total } };
}

export async function respondToInvitation(actorId: string, invitationId: string, action: 'accept' | 'decline') {
  const reference = await database.teamInvitation.findUnique({ where: { id: invitationId }, select: { teamId: true } });
  if (!reference) throw new AppError(404, 'Invitation not found');
  const outcome = await database.$transaction(async (tx) => {
    // Same lock order as invitation creation and all membership mutations.
    await lockTeam(tx, reference.teamId);
    const user = await tx.user.findUnique({ where: { id: actorId }, select: { email: true } });
    const invitation = await tx.teamInvitation.findUnique({ where: { id: invitationId } });
    if (!user || !invitation || invitation.invitedEmail !== user.email) {
      throw new AppError(404, 'Invitation not found');
    }
    const now = new Date();
    if (invitation.status === 'PENDING' && invitation.expiresAt <= now) {
      await tx.teamInvitation.update({ where: { id: invitationId }, data: { status: 'EXPIRED' } });
      // Commit expiration before returning the expected rejection.
      return { kind: 'expired' as const };
    }
    if (action === 'decline' && invitation.status === 'DECLINED') {
      return { kind: 'success' as const, invitation };
    }
    if (invitation.status !== 'PENDING') throw new AppError(409, 'Invitation is no longer pending');
    if (action === 'accept') {
      const existing = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId: invitation.teamId, userId: actorId } },
      });
      if (existing) throw new AppError(409, 'User is already a team member');
      await tx.teamMember.create({ data: { teamId: invitation.teamId, userId: actorId, role: 'MEMBER' } });
    }
    const updated = await tx.teamInvitation.update({ where: { id: invitationId }, data: {
      status: action === 'accept' ? 'ACCEPTED' : 'DECLINED', respondedAt: now,
    } });
    return { kind: 'success' as const, invitation: updated };
  });
  if (outcome.kind === 'expired') throw new AppError(409, 'Invitation is no longer pending');
  return outcome.invitation;
}
