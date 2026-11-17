import { database } from '../../config/database.js';
import { AppError } from '../../shared/app-error.js';
import { paginationArgs, type Pagination, type CreateDetails, type UpdateDetails } from '../../shared/request-schemas.js';
import { managers, requireMembership, withTeamWrite } from '../teams/team-authorization.js';

export function createProject(actorId: string, teamId: string, input: CreateDetails) {
  return withTeamWrite(teamId, actorId, managers, async (tx) => tx.project.create({ data: {
    teamId, createdById: actorId, name: input.name, description: input.description ?? null,
  } }));
}

export function listProjects(actorId: string, teamId: string, pagination: Pagination) {
  return database.$transaction(async (tx) => {
    await requireMembership(tx, teamId, actorId);
    const projects = await tx.project.findMany({ where: { teamId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...paginationArgs(pagination) });
    return { projects, pagination: { ...pagination, total: await tx.project.count({ where: { teamId } }) } };
  });
}

export async function getProject(actorId: string, projectId: string) {
  const project = await database.project.findFirst({ where: {
    id: projectId, team: { memberships: { some: { userId: actorId } } },
  } });
  if (!project) throw new AppError(404, 'Project not found');
  return project;
}

export async function updateProject(actorId: string, projectId: string, input: UpdateDetails) {
  const project = await getProject(actorId, projectId);
  return withTeamWrite(project.teamId, actorId, managers, async (tx) =>
    tx.project.update({ where: { id: projectId }, data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    } }));
}
