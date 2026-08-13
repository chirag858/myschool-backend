import { StudentModel } from '../students/student.model';
import { CertificateModel } from './certificates.models';

function toRow(d: Record<string, unknown> & { _id: unknown; createdAt?: Date }) {
  return {
    id: String(d._id),
    type: d.type,
    studentName: d.studentName ?? '',
    classLabel: d.classLabel ?? '',
    certificateNumber: d.certificateNumber ?? '',
    generatedBy: d.generatedBy ?? '',
    generatedAt: (d.createdAt ?? new Date()).toISOString?.() ?? String(d.createdAt),
  };
}

export const certificatesService = {
  async getHistory(schoolId: string) {
    const docs = await CertificateModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toRow);
  },

  async generateTCNumber(schoolId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await CertificateModel.countDocuments({
      schoolId,
      type: 'transfer',
      createdAt: { $gte: new Date(`${year}-01-01`) },
    });
    return `TC-${year}-${(count + 1).toString().padStart(4, '0')}`;
  },

  async generate(
    schoolId: string,
    generatedBy: string,
    payload: {
      studentId: string;
      studentName: string;
      classLabel: string;
      type: string;
      details: Record<string, unknown>;
    },
  ) {
    const year = new Date().getFullYear();
    const count = await CertificateModel.countDocuments({
      schoolId,
      createdAt: { $gte: new Date(`${year}-01-01`) },
    });
    const certificateNumber = `CERT-${year}-${(count + 1).toString().padStart(4, '0')}`;
    const doc = await CertificateModel.create({
      schoolId,
      type: payload.type,
      studentId: payload.studentId,
      studentName: payload.studentName,
      classLabel: payload.classLabel,
      certificateNumber,
      generatedBy,
      details: payload.details,
    });
    return {
      certificateNumber: doc.certificateNumber,
      generatedAt: doc.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  },

  async markStudentTCIssued(schoolId: string, studentId: string) {
    await StudentModel.updateOne(
      { _id: studentId, schoolId },
      { $set: { profileStatus: 'tc_issued' } },
    );
    return { ok: true as const };
  },
};
