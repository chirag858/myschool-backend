import { Schema, model, type InferSchemaType } from 'mongoose';

const examAuditLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    classKey: { type: String, default: '' },
    subjectId: { type: String, default: '' },
    action: { type: String, required: true },
    performedBy: { type: String, default: 'System' },
    details: String,
    timestamp: { type: String, required: true },
  },
  { timestamps: true },
);
export type ExamAuditLogDoc = InferSchemaType<typeof examAuditLogSchema>;
export const ExamAuditLogModel = model('ExamAuditLog', examAuditLogSchema);
