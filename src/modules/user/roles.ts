/** Every role the platform supports (web staff + mobile). Mirrors the
 *  frontend `USER_ROLES` plus mobile-only `student` and `driver`. */
export const USER_ROLES = [
  'super_admin',
  'support_engineer',
  'school_admin',
  'principal',
  'coordinator',
  'accountant',
  'teacher',
  'receptionist',
  'gate_manager',
  'parent',
  'student',
  'driver',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Roles that operate outside a single school (no tenant scope). */
export const PLATFORM_ROLES: readonly UserRole[] = ['super_admin', 'support_engineer'];

/** School staff roles (used for staff counts + gating). */
export const STAFF_ROLES: readonly UserRole[] = [
  'school_admin', 'principal', 'coordinator', 'accountant', 'teacher', 'receptionist', 'gate_manager',
];

/** Roles allowed to manage academic master data. */
export const ACADEMIC_ADMIN_ROLES: readonly UserRole[] = ['school_admin', 'principal', 'coordinator'];
