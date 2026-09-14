import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** Parent-raised request (leave / appointment / ptm) with a multi-stage approval. */
const requestSchema = new Schema(
  {
    schoolId: school,
    childId: { type: String, required: true, index: true },
    parentUserId: { type: String, default: '' },
    type: { type: String, enum: ['leave', 'appointment', 'ptm'], default: 'leave' },
    title: { type: String, default: '' },
    createdAt: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'under_review', 'approved', 'rejected', 'cancelled', 'scheduled'], default: 'pending' },
    fields: { type: [Schema.Types.Mixed], default: [] },
    stages: { type: [Schema.Types.Mixed], default: [] },
    canCancel: { type: Boolean, default: true },
    attachments: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: false },
);

/** An outpass initiated by staff; the parent approves with OTP. */
const outpassSchema = new Schema(
  {
    schoolId: school,
    childId: { type: String, required: true, index: true },
    reason: { type: String, default: '' },
    date: { type: String, default: '' },
    requestedBy: String,
    status: { type: String, enum: ['awaiting_parent', 'approved', 'declined', 'exited', 'returned'], default: 'awaiting_parent' },
    exitTime: String,
    entryTime: String,
  },
  { timestamps: true },
);

/** A messaging conversation between a parent (for a child) and a staff counterpart. */
const conversationSchema = new Schema(
  {
    schoolId: school,
    parentUserId: { type: String, index: true },
    childId: { type: String, default: '' },
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    avatarUrl: String,
    lastMessage: { type: String, default: '' },
    lastAt: { type: String, default: '' },
    unread: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const messageSchema = new Schema(
  {
    schoolId: school,
    conversationId: { type: String, required: true, index: true },
    body: { type: String, default: '' },
    at: { type: String, default: '' },
    senderIsParent: { type: Boolean, default: true },
    senderName: String,
  },
  { timestamps: true },
);

/** Reward / merit points for a child. */
const rewardSchema = new Schema(
  {
    schoolId: school,
    childId: { type: String, required: true, index: true },
    title: { type: String, default: '' },
    points: { type: Number, default: 0 },
    reason: { type: String, default: '' },
    date: { type: String, default: '' },
  },
  { timestamps: false },
);

/** Per-parent read state for a notification. */
const notifReadSchema = new Schema(
  {
    schoolId: school,
    parentUserId: { type: String, required: true, index: true },
    childId: { type: String, default: '' },
    notificationId: { type: String, required: true },
  },
  { timestamps: true },
);
notifReadSchema.index({ parentUserId: 1, notificationId: 1 }, { unique: true });

export type RequestDoc = InferSchemaType<typeof requestSchema>;
export const ParentRequestModel = model('ParentRequest', requestSchema);
export const OutpassModel = model('Outpass', outpassSchema);
export const ConversationModel = model('ParentConversation', conversationSchema);
export const MessageModel = model('ParentMessage', messageSchema);
export const RewardModel = model('StudentReward', rewardSchema);
export const ParentNotifReadModel = model('ParentNotifRead', notifReadSchema);
