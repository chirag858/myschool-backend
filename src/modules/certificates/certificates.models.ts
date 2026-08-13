import { Schema, model, type InferSchemaType } from 'mongoose';

export const CERTIFICATE_TYPES = ['transfer', 'bonafide', 'character', 'study', 'migration', 'custom'] as const;

const certificateSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    type: { type: String, enum: CERTIFICATE_TYPES, required: true },
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, default: '' },
    classLabel: { type: String, default: '' },
    certificateNumber: { type: String, required: true },
    generatedBy: { type: String, default: '' },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export type CertificateDoc = InferSchemaType<typeof certificateSchema>;
export const CertificateModel = model('Certificate', certificateSchema);
