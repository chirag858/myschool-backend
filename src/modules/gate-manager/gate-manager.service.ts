import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { UserModel } from '../user/user.model';
import { PickupModel, TeacherPassModel, VisitorModel } from './gate-manager.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const todayPrefix = (): string => nowIso().slice(0, 10);

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

async function operatorName(userId: string): Promise<string> {
  const u = await UserModel.findById(userId).lean();
  return (u?.name as string) ?? 'Gate Operator';
}

export const gateManagerService = {
  async searchStudents(schoolId: string, q: string) {
    const students = await StudentModel.find({ schoolId, profileStatus: 'active' })
      .select('name admissionNumber className section rollNumber')
      .sort({ className: 1, rollNumber: 1 })
      .lean();
    // A student is "outside" if released (passed_out) at the gate today.
    const outToday = await PickupModel.find({
      schoolId,
      status: 'passed_out',
      outTime: { $regex: `^${todayPrefix()}` },
    })
      .select('studentId')
      .lean();
    const outside = new Set(outToday.map((p) => String(p.studentId)));

    const term = q.trim().toLowerCase();
    return students
      .filter(
        (s) =>
          !term ||
          s.name.toLowerCase().includes(term) ||
          (s.admissionNumber ?? '').toLowerCase().includes(term) ||
          (s.className ?? '').toLowerCase().includes(term),
      )
      .map((s) => ({
        id: String(s._id),
        admissionNumber: s.admissionNumber ?? '',
        name: s.name,
        className: s.className ?? '',
        section: s.section ?? '',
        rollNumber: s.rollNumber ?? '',
        inside: !outside.has(String(s._id)),
      }));
  },

  async getPickups(schoolId: string) {
    return (await PickupModel.find({ schoolId }).sort({ outTime: -1 }).lean()).map(dto);
  },

  async releaseStudent(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const student = await StudentModel.findOne({ _id: String(payload.studentId), schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');
    const now = nowIso();
    const doc = await PickupModel.create({
      schoolId,
      studentId: String(student._id),
      studentName: student.name,
      className: student.className,
      section: student.section,
      admissionNumber: student.admissionNumber,
      pickupBy: payload.pickupByName,
      relation: payload.relation,
      mobile: payload.pickupByMobile,
      reason: payload.reason,
      proofPhotoUrl: payload.proofPhotoUrl,
      verificationMethod: payload.verificationMethod,
      inTime: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      outTime: now,
      approvedBy: await operatorName(userId),
      status: 'passed_out',
      notes: payload.notes,
    });
    return dto(doc.toObject());
  },

  // Demo OTP — the UI echoes it back to the operator to read aloud.
  sendOtp(): { otp: string } {
    return { otp: String(Math.floor(100000 + Math.random() * 900000)) };
  },

  async getVisitors(schoolId: string) {
    return (await VisitorModel.find({ schoolId }).sort({ inTime: -1 }).lean()).map(dto);
  },

  async logVisitor(schoolId: string, payload: Record<string, unknown>) {
    const count = await VisitorModel.countDocuments({ schoolId });
    const { id, inTime, passNumber, ...fields } = payload;
    void id;
    void inTime;
    void passNumber;
    const doc = await VisitorModel.create({
      schoolId,
      ...fields,
      inTime: nowIso(),
      passNumber: `V-${1000 + count + 45}`,
    });
    return dto(doc.toObject());
  },

  async checkoutVisitor(schoolId: string, id: string) {
    const doc = await VisitorModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { outTime: nowIso() } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Visitor not found');
    return dto(doc.toObject());
  },

  async getTeacherPasses(schoolId: string) {
    return (await TeacherPassModel.find({ schoolId }).sort({ outTime: -1 }).lean()).map(dto);
  },

  async logTeacherPass(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const { id, outTime, issuedBy, ...fields } = payload;
    void id;
    void outTime;
    void issuedBy;
    const doc = await TeacherPassModel.create({
      schoolId,
      ...fields,
      outTime: nowIso(),
      issuedBy: await operatorName(userId),
    });
    return dto(doc.toObject());
  },

  async returnTeacherPass(schoolId: string, id: string) {
    const doc = await TeacherPassModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { returnedAt: nowIso() } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Gate pass not found');
    return dto(doc.toObject());
  },

  async dashboard(schoolId: string) {
    const today = todayPrefix();
    const [activeStudents, passedOutToday, pendingPickups, pickupsToday, visitorsInside, visitorsToday] =
      await Promise.all([
        StudentModel.countDocuments({ schoolId, profileStatus: 'active' }),
        PickupModel.countDocuments({ schoolId, status: 'passed_out', outTime: { $regex: `^${today}` } }),
        PickupModel.countDocuments({ schoolId, status: { $in: ['pending', 'verifying'] } }),
        PickupModel.countDocuments({ schoolId, outTime: { $regex: `^${today}` } }),
        VisitorModel.countDocuments({ schoolId, outTime: { $in: [null, undefined] } }),
        VisitorModel.countDocuments({ schoolId, inTime: { $regex: `^${today}` } }),
      ]);
    return {
      studentsInside: Math.max(activeStudents - passedOutToday, 0),
      pickupsToday,
      pendingPickups,
      passedOutToday,
      visitorsInside,
      visitorsToday,
    };
  },
};
