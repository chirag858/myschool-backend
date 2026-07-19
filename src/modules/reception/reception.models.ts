import { Schema, model, type InferSchemaType } from 'mongoose';

const appointmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    visitorName: { type: String, required: true },
    visitorMobile: { type: String, default: '' },
    date: { type: String, default: '' },
    time: { type: String, default: '' },
    durationMinutes: { type: Number, default: 30 },
    purpose: { type: String, default: 'other' },
    withWhom: { type: String, default: '' },
    notes: String,
    status: { type: String, default: 'scheduled' },
    sendReminder: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export type AppointmentDoc = InferSchemaType<typeof appointmentSchema>;
export const AppointmentModel = model('Appointment', appointmentSchema);

const callLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    loggedAt: { type: String, default: '' },
    direction: { type: String, default: 'incoming' },
    callerName: { type: String, default: '' },
    mobile: { type: String, default: '' },
    purpose: { type: String, default: 'other' },
    relatedStudentName: String,
    notes: String,
    followUpRequired: { type: Boolean, default: false },
    followUpDate: String,
    assignedTo: String,
    followUpDone: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export type CallLogDoc = InferSchemaType<typeof callLogSchema>;
export const CallLogModel = model('CallLog', callLogSchema);
