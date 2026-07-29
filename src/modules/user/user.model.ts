import { Schema, model, type InferSchemaType } from 'mongoose';

import { USER_ROLES } from './roles';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Staff login handle (parents/students log in by mobile). */
    username: { type: String, trim: true, lowercase: true, index: true, sparse: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    mobile: { type: String, trim: true, index: true },
    role: { type: String, enum: USER_ROLES, required: true },
    passwordHash: { type: String, select: false },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    schoolName: { type: String },
    active: { type: Boolean, default: true },
    dateOfBirth: { type: String, default: '' },
    address: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: '' },
  },
  { timestamps: true },
);

userSchema.index({ email: 1, schoolId: 1 }, { unique: true });

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
