import { Schema, model, type InferSchemaType } from 'mongoose';

const circularSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    number: { type: String, default: '' },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    dateOfIssue: { type: String, default: '' },
    audience: { type: [String], default: [] },
    specificClasses: { type: [String], default: [] },
    priority: { type: String, default: 'normal' },
    attachments: { type: [Schema.Types.Mixed], default: [] },
    deliveryChannels: { type: [String], default: [] },
    scheduleAt: String,
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    views: { type: Number, default: 0 },
    createdBy: { type: String, default: 'System' },
  },
  { timestamps: true },
);
export type CircularDoc = InferSchemaType<typeof circularSchema>;
export const CircularModel = model('Circular', circularSchema);

const announcementSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    priority: { type: String, default: 'normal' },
    audience: { type: [String], default: [] },
    displayUntil: String,
    pinned: { type: Boolean, default: false },
    postedBy: { type: String, default: 'System' },
    postedAt: { type: String, default: '' },
  },
  { timestamps: true },
);
export type AnnouncementDoc = InferSchemaType<typeof announcementSchema>;
export const AnnouncementModel = model('Announcement', announcementSchema);

const notificationSchema = new Schema({
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  category: { type: String, default: 'general' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  createdAt: { type: String, default: '' },
  read: { type: Boolean, default: false },
  navigateTo: String,
});
export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const NotificationModel = model('Notification', notificationSchema);

const prefsSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
    feePaymentReceived: { type: Boolean, default: true },
    newAbsentStudent: { type: Boolean, default: true },
    leaveApplicationSubmitted: { type: Boolean, default: true },
    newSupportTicket: { type: Boolean, default: true },
    subscriptionExpiring: { type: Boolean, default: true },
    lowAttendanceWarning: { type: Boolean, default: true },
    examResultPublished: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type PrefsDoc = InferSchemaType<typeof prefsSchema>;
export const NotificationPrefsModel = model('NotificationPrefs', prefsSchema);
