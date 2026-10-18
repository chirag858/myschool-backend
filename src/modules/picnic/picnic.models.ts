import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

const participantSchema = new Schema(
  {
    studentId: { type: String, required: true },
    studentName: { type: String, required: true },
    admissionNumber: { type: String, default: '' },
    className: { type: String, default: '' },
    section: { type: String, default: '' },
  },
  { _id: false },
);

/** A picnic/trip a coordinator builds from their assigned classes, routed to
 * the gate manager for approval + pass generation. Lifecycle:
 * draft → submitted → approved/rejected → (approved only) passes_generated. */
const picnicSchema = new Schema(
  {
    schoolId: school,
    title: { type: String, required: true },
    destination: { type: String, required: true },
    date: { type: String, required: true },
    startTime: { type: String, default: '' },
    endTime: { type: String, default: '' },
    description: { type: String, default: '' },
    instructions: { type: String, default: '' },
    classKeys: { type: [String], default: [] },
    participants: { type: [participantSchema], default: [] },
    pricePerStudent: { type: Number, required: true, min: 0 },
    totalParticipants: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'rejected', 'passes_generated'],
      default: 'draft',
      index: true,
    },
    createdBy: { type: String, required: true, index: true },
    createdByName: { type: String, default: '' },
    submittedAt: String,
    decidedAt: String,
    decidedBy: String,
    decidedByName: String,
    rejectionReason: String,
    passesGeneratedAt: String,
    passesGeneratedBy: String,
    passesGeneratedByName: String,
  },
  { timestamps: true },
);
picnicSchema.index({ schoolId: 1, status: 1 });

/** One pass per confirmed participant, issued only after approval. */
const picnicPassSchema = new Schema(
  {
    schoolId: school,
    picnicId: { type: Schema.Types.ObjectId, ref: 'Picnic', required: true, index: true },
    studentId: { type: String, required: true },
    studentName: { type: String, required: true },
    admissionNumber: { type: String, default: '' },
    className: { type: String, default: '' },
    section: { type: String, default: '' },
    passNumber: { type: String, required: true },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    issuedAt: { type: String, required: true },
    issuedBy: { type: String, default: '' },
    issuedByName: { type: String, default: '' },
  },
  { timestamps: true },
);
picnicPassSchema.index({ schoolId: 1, picnicId: 1, studentId: 1 }, { unique: true });

/** Per-school atomic sequence counter — reuses the gate-manager's counter
 * convention (schoolId+key unique) rather than inventing a new scheme. */
const picnicCounterSchema = new Schema({
  schoolId: school,
  key: { type: String, required: true },
  value: { type: Number, default: 0 },
});
picnicCounterSchema.index({ schoolId: 1, key: 1 }, { unique: true });

export type PicnicDoc = InferSchemaType<typeof picnicSchema>;
export type PicnicPassDoc = InferSchemaType<typeof picnicPassSchema>;

export const PicnicModel = model('Picnic', picnicSchema);
export const PicnicPassModel = model('PicnicPass', picnicPassSchema);
export const PicnicCounterModel = model('PicnicCounter', picnicCounterSchema);
