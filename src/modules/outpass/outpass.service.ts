import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { UserModel } from '../user/user.model';
import { AdminGateVisitorModel, OutPassModel } from './outpass.models';

type Doc = Record<string, unknown> & { _id: unknown };

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function operatorName(userId: string | undefined): Promise<string> {
  if (!userId) return 'Gate Operator';
  const u = await UserModel.findById(userId).lean();
  return (u?.name as string) ?? 'Gate Operator';
}

export const outpassService = {
  async list(schoolId: string) {
    const docs = await OutPassModel.find({ schoolId }).sort({ issueTime: -1 }).lean();
    const now = nowIso();
    return docs.map((d) => {
      const row = dto(d);
      if (row.status === 'issued' && typeof row.expectedReturn === 'string' && row.expectedReturn < now) {
        row.status = 'overdue';
      }
      return row;
    });
  },

  async issue(
    schoolId: string,
    userId: string | undefined,
    payload: {
      studentId: string;
      purpose: string;
      destination: string;
      expectedReturn: string;
      parentApprovalRequired: boolean;
      otpVerified: boolean;
      remarks?: string;
    },
  ) {
    const student = await StudentModel.findOne({ _id: payload.studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');

    const year = new Date().getFullYear();
    const count = await OutPassModel.countDocuments({
      schoolId,
      createdAt: { $gte: new Date(`${year}-01-01`) },
    });
    const outPassNumber = `OP-${year}-${(count + 1).toString().padStart(4, '0')}`;

    const doc = await OutPassModel.create({
      schoolId,
      outPassNumber,
      studentId: String(student._id),
      studentName: student.name,
      studentPhoto: student.photoUrl,
      className: `${student.className ?? ''}-${student.section ?? ''}`,
      fatherName: student.parents?.fatherName ?? student.fatherName ?? '',
      fatherMobile: student.parents?.fatherMobile ?? '',
      purpose: payload.purpose,
      destination: payload.destination,
      issueTime: nowIso(),
      expectedReturn: new Date(payload.expectedReturn).toISOString(),
      issuedBy: await operatorName(userId),
      parentApprovalRequired: payload.parentApprovalRequired,
      otpVerified: payload.otpVerified,
      remarks: payload.remarks,
      status: 'issued',
    });
    return dto(doc.toObject());
  },

  async recordReturn(schoolId: string, id: string) {
    const doc = await OutPassModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { actualReturn: nowIso(), status: 'returned' } },
      { new: true },
    ).lean();
    if (!doc) throw ApiError.notFound('Out-pass not found');
    return dto(doc);
  },

  async cancel(schoolId: string, id: string) {
    const doc = await OutPassModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { status: 'cancelled' } },
      { new: true },
    ).lean();
    if (!doc) throw ApiError.notFound('Out-pass not found');
    return dto(doc);
  },

  // Demo OTP — the UI echoes it back to the operator to read aloud.
  sendOtp(): { otpMockExpected: string } {
    return { otpMockExpected: String(Math.floor(1000 + Math.random() * 9000)) };
  },

  async listVisitors(schoolId: string) {
    return (await AdminGateVisitorModel.find({ schoolId }).sort({ checkInTime: -1 }).lean()).map(dto);
  },

  async addVisitor(
    schoolId: string,
    payload: {
      visitorName: string;
      mobile?: string;
      idProofType?: string;
      idProofNumber?: string;
      personToMeet: string;
      purpose: string;
      department?: string;
      roomNumber?: string;
      vehicleNumber?: string;
      photoUrl?: string;
    },
  ) {
    const doc = await AdminGateVisitorModel.create({
      schoolId,
      ...payload,
      checkInTime: nowIso(),
    });
    return dto(doc.toObject());
  },

  async checkoutVisitor(schoolId: string, id: string) {
    const doc = await AdminGateVisitorModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { checkOutTime: nowIso() } },
      { new: true },
    ).lean();
    if (!doc) throw ApiError.notFound('Visitor not found');
    return dto(doc);
  },
};
