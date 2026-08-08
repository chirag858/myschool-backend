import { Schema, model, type InferSchemaType } from 'mongoose';

import { USER_ROLES } from './roles';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Staff login handle (parents/students log in by mobile). */
    username: { type: String, trim: true, lowercase: true, index: true, sparse: true },
    email: { type: String, lowercase: true, trim: true, sparse: true },
    mobile: { type: String, trim: true, index: true },
    role: { type: String, enum: USER_ROLES, required: true },
    passwordHash: { type: String, select: false },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    schoolName: { type: String },
    active: { type: Boolean, default: true },
    /** Forces a password-change prompt at next login (set on parent-account
     * creation/reset, cleared on successful change-password). */
    mustChangePassword: { type: Boolean, default: false },
    dateOfBirth: { type: String, default: '' },
    address: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: '' },
    /** Class-section keys (e.g. "V-A") a coordinator/teacher supervises. */
    assignedClasses: { type: [String], default: [] },
    /** Free-text display title for a coordinator (e.g. "Wing Coordinator", "Sports
     * Coordinator") — schools define their own, so this is not a fixed enum. Purely
     * cosmetic: permissions/routes stay gated on the single 'coordinator' role. */
    coordinatorTitle: { type: String, default: '' },
  },
  { timestamps: true },
);

// `sparse` on a COMPOUND index only skips a document when EVERY indexed
// field is missing — since `schoolId` is always set, a document with a
// missing `email` alone still gets indexed as {email: null, schoolId: X},
// so a second parent account (no email, same school) collided on that as
// a duplicate key. A partial index with an explicit filter is the correct
// way to say "unique only when email is actually present".
userSchema.index(
  { email: 1, schoolId: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true, $type: 'string' } } },
);
// Username only needs to be unique within a school — the login flow now
// disambiguates by school code first, so the same handle (e.g. "accountant")
// can exist at multiple schools without colliding.
userSchema.index(
  { schoolId: 1, username: 1 },
  { unique: true, partialFilterExpression: { username: { $exists: true, $type: 'string' } } },
);
userSchema.index({ mobile: 1, schoolId: 1, role: 1 });

// Never leak the hash; serialize ids to strings (frontend reads `_id`).
userSchema.set('toJSON', {
  transform(_doc, ret: Record<string, unknown>) {
    ret._id = String(ret._id);
    if (ret.schoolId) ret.schoolId = String(ret.schoolId);
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export type UserDoc = InferSchemaType<typeof userSchema>;
export const UserModel = model('User', userSchema);
