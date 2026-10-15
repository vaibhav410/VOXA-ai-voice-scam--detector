// Authorization rules (PRD FR-03, 13.4). Pure functions, default deny.
//
// Global role: super_admin (granted only by the server CLI). Team roles: admin, user.
// Reports: personal reports (team_id null) are visible to their owner only. A report shared to a team is visible to
// that team's members. Delete/status changes: the owner, or an admin of the report's team.
// Super admins manage teams and read audit events; they get no automatic access to other people's personal reports.
export const TEAM_ROLES = Object.freeze(['admin', 'user']);
export const isTeamRole = r => TEAM_ROLES.includes(r);

export const teamRole = (user, teamId) => (teamId && user?.memberships?.find(m => m.team_id === teamId)?.role) || null;
const active = user => Boolean(user && user.id && user.status === 'active');

export function canReadAnalysis(user, a) {
  if (!active(user) || !a) return false;
  if (a.owner_user_id === user.id) return true;
  return Boolean(a.team_id && isTeamRole(teamRole(user, a.team_id)));
}
export function canModifyAnalysis(user, a) {
  if (!active(user) || !a) return false;
  if (a.owner_user_id === user.id) return true;
  return Boolean(a.team_id && teamRole(user, a.team_id) === 'admin');
}
export const canShareToTeam = (user, teamId) => active(user) && isTeamRole(teamRole(user, teamId));
export const canViewTeam = (user, teamId) => active(user) && (isTeamRole(teamRole(user, teamId)) || user.isSuperAdmin === true);
export const canManageTeam = (user, teamId) => active(user) && (teamRole(user, teamId) === 'admin' || user.isSuperAdmin === true);
export const canReadAudit = user => active(user) && user.isSuperAdmin === true;
// Roles an API caller may grant: only team roles, never super_admin.
export const grantableRole = r => (isTeamRole(r) ? r : null);
