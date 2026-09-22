import type { AdminRole } from "@prisma/client";

/** Защита от потери доступа: нельзя отключить/понизить себя или последнего владельца */
export function checkStaffChange(input: {
  actorId: string;
  targetId: string;
  targetRole: AdminRole;
  targetActive: boolean;
  newRole?: AdminRole;
  newActive?: boolean;
  activeSuperAdmins: number;
}): string | null {
  const demoting = input.newRole !== undefined && input.newRole !== input.targetRole && input.targetRole === "SUPER_ADMIN";
  const deactivating = input.newActive === false && input.targetActive;
  if (input.actorId === input.targetId && (demoting || deactivating)) return "self";
  if ((demoting || deactivating) && input.targetRole === "SUPER_ADMIN" && input.targetActive && input.activeSuperAdmins <= 1) return "last_owner";
  return null;
}
