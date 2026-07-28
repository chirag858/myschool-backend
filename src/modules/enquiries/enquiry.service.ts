import { Types } from 'mongoose';
import { ApiError } from '../../lib/api-error';
import { EnquiryModel } from './enquiry.model';

interface EnquiryPayload {
  studentName: string;
  fatherName?: string;
  mobile?: string;
  interestedClass?: string;
  source?: string;
  followUpDate?: string;
  notes?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(d: any) {
  return {
    id: String(d._id),
    enquiryDate: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
    studentName: String(d.studentName ?? ''),
    fatherName: String(d.fatherName ?? ''),
    mobile: String(d.mobile ?? ''),
    interestedClass: String(d.interestedClass ?? ''),
    source: String(d.source ?? 'walk_in'),
    followUpDate: d.followUpDate || undefined,
    status: String(d.status ?? 'new'),
    notes: d.notes || undefined,
  };
}

export const enquiryService = {
  async list(schoolId: string) {
    const docs = await EnquiryModel.find({ schoolId: new Types.ObjectId(schoolId) })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map(toRow);
  },

  async create(schoolId: string, payload: EnquiryPayload) {
    const doc = await EnquiryModel.create({
      schoolId: new Types.ObjectId(schoolId),
      studentName: payload.studentName,
      fatherName: payload.fatherName ?? '',
      mobile: payload.mobile ?? '',
      interestedClass: payload.interestedClass ?? '',
      source: payload.source ?? 'walk_in',
      followUpDate: payload.followUpDate ?? '',
      status: 'new',
      notes: payload.notes ?? '',
    });
    return toRow(doc.toObject());
  },

  async updateStatus(schoolId: string, id: string, status: string) {
    const doc = await EnquiryModel.findOneAndUpdate(
      { _id: id, schoolId: new Types.ObjectId(schoolId) },
      { status },
      { new: true },
    ).lean();
    if (!doc) throw ApiError.notFound('Enquiry not found');
    return toRow(doc);
  },

  async delete(schoolId: string, id: string) {
    const res = await EnquiryModel.deleteOne({ _id: id, schoolId: new Types.ObjectId(schoolId) });
    if (res.deletedCount === 0) throw ApiError.notFound('Enquiry not found');
  },

  async convert(schoolId: string, id: string) {
    const doc = await EnquiryModel.findOneAndUpdate(
      { _id: id, schoolId: new Types.ObjectId(schoolId) },
      { status: 'admitted' },
      { new: true },
    ).lean();
    if (!doc) throw ApiError.notFound('Enquiry not found');
    // Return the enquiry id so the frontend can pre-fill the admission form
    return { admissionDraftId: id };
  },
};
