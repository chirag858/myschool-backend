import { Schema, model, type InferSchemaType } from 'mongoose';

const enquirySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentName: { type: String, required: true },
    fatherName: { type: String, default: '' },
    mobile: { type: String, default: '' },
    interestedClass: { type: String, default: '' },
    source: {
      type: String,
      enum: ['walk_in', 'phone', 'website', 'referral'],
      default: 'walk_in',
    },
    followUpDate: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'contacted', 'follow_up', 'admitted', 'not_interested'],
      default: 'new',
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

export type EnquiryDoc = InferSchemaType<typeof enquirySchema>;
export const EnquiryModel = model('Enquiry', enquirySchema);
