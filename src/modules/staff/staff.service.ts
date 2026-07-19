import { ApiError } from '../../lib/api-error';
import { StaffAttendanceLockModel, StaffAttendanceModel, StaffModel } from './staff.models';

type Doc = Record<string, unknown> & { _id: unknown };
const round = (n: number): number => Math.round(n);
const today = (): string => new Date().toISOString().slice(0, 10);

function toRow(d: Doc) {
  return {
    id: String(d._id),
    employeeId: d.employeeId,
    name: d.name,
    designation: d.designation ?? '',
    designationLabel: d.designationLabel ?? '',
    department: d.department ?? '',
    departmentLabel: d.departmentLabel ?? '',
    employmentType: d.employmentType ?? 'full_time',
    status: d.status ?? 'active',
    mobile: d.mobile ?? '',
    email: d.email,
    joiningDate: d.joiningDate ?? '',
    photoUrl: d.photoUrl,
    basic: d.basic ?? 0,
    netSalary: d.netSalary ?? 0,
  };
}
function toProfile(d: Doc) {
  return {
    ...toRow(d),
    dateOfBirth: d.dateOfBirth ?? '',
    gender: d.gender ?? 'male',
    bloodGroup: d.bloodGroup ?? '',
    religion: d.religion ?? '',
    caste: d.caste,
    nationality: d.nationality ?? 'Indian',
    aadhaar: d.aadhaar,
    pan: d.pan,
    emergencyContactName: d.emergencyContactName ?? '',
    emergencyContactMobile: d.emergencyContactMobile ?? '',
    personalEmail: d.personalEmail,
    currentAddress: d.currentAddress ?? {},
    permanentSameAsCurrent: d.permanentSameAsCurrent ?? true,
    permanentAddress: d.permanentAddress ?? {},
    reportingToName: d.reportingToName,
    reportingToId: d.reportingToId,
    workingHoursPerDay: d.workingHoursPerDay ?? 8,
    weeklyOffDays: d.weeklyOffDays ?? ['sun'],
    qualifications: d.qualifications ?? [],
    experience: d.experience ?? [],
    teachingSubjects: d.teachingSubjects ?? [],
    teachingClasses: d.teachingClasses ?? [],
    teachingExperienceYears: d.teachingExperienceYears,
    salaryStructure: d.salaryStructure ?? {},
    salaryRevisions: d.salaryRevisions ?? [],
  };
}

async function nextEmployeeId(schoolId: string): Promise<string> {
  const count = await StaffModel.countDocuments({ schoolId });
  return `EMP${String(count + 1).padStart(4, '0')}`;
}

export const staffService = {
  async getStaff(schoolId: string, q: Record<string, string>) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.max(1, Number(q.pageSize) || 10);
    const filter: Record<string, unknown> = { schoolId };
    for (const key of ['department', 'employmentType', 'status', 'designation'] as const) {
      if (q[key] && q[key] !== 'all') filter[key] = q[key];
    }
    if (q.search?.trim()) {
      const rx = new RegExp(q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { employeeId: rx }, { mobile: rx }, { designationLabel: rx }];
    }
    const [docs, total] = await Promise.all([
      StaffModel.find(filter).sort({ name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      StaffModel.countDocuments(filter),
    ]);
    return { rows: docs.map(toRow), total, page, pageSize };
  },

  async stats(schoolId: string) {
    const all = await StaffModel.find({ schoolId }).lean();
    const month = today().slice(0, 7);
    const onLeave = await StaffAttendanceModel.countDocuments({ schoolId, date: today(), status: 'leave' });
    return {
      totalStaff: all.length,
      teachingCount: all.filter((s) => s.category === 'teaching').length,
      nonTeachingCount: all.filter((s) => s.category !== 'teaching').length,
      onLeaveToday: onLeave,
      newJoiningsThisMonth: all.filter((s) => (s.joiningDate ?? '').startsWith(month)).length,
    };
  },

  async generateEmployeeId(schoolId: string) {
    return { employeeId: await nextEmployeeId(schoolId) };
  },
  async checkEmployeeId(schoolId: string, employeeId: string) {
    const taken = (await StaffModel.countDocuments({ schoolId, employeeId })) > 0;
    return { taken };
  },

  async getProfile(schoolId: string, id: string) {
    const d = await StaffModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Staff not found');
    return toProfile(d);
  },

  async createStaff(schoolId: string, payload: Record<string, unknown>) {
    const employeeId = await nextEmployeeId(schoolId);
    const basic = Number(payload.basic) || 0;
    const doc = await StaffModel.create({
      schoolId,
      ...payload,
      employeeId,
      status: 'active',
      netSalary: round(basic * 1.37),
    });
    return toRow(doc.toObject());
  },

  async updateStatus(schoolId: string, id: string, status: string) {
    const doc = await StaffModel.findOneAndUpdate({ _id: id, schoolId }, { status }, { new: true });
    if (!doc) throw ApiError.notFound('Staff not found');
    return toRow(doc.toObject());
  },

  // ── Attendance ──
  async getAttendance(schoolId: string, date: string) {
    const staff = await StaffModel.find({ schoolId }).sort({ name: 1 }).lean();
    const records = await StaffAttendanceModel.find({ schoolId, date }).lean();
    const byStaff = new Map(records.map((r) => [String(r.staffId), r]));
    const lock = await StaffAttendanceLockModel.findOne({ schoolId, date }).lean();
    return {
      rows: staff.map((s) => {
        const r = byStaff.get(String(s._id));
        return {
          id: String(s._id),
          employeeId: s.employeeId,
          name: s.name,
          designation: s.designationLabel ?? s.designation ?? '',
          department: s.department ?? '',
          photoUrl: s.photoUrl,
          status: r?.status ?? null,
          timeIn: r?.timeIn,
          timeOut: r?.timeOut,
          remarks: r?.remarks,
        };
      }),
      locked: Boolean(lock?.locked),
    };
  },

  async saveAttendance(
    schoolId: string,
    date: string,
    attendance: Array<{ staffId: string; status: string; timeIn?: string; timeOut?: string; remarks?: string }>,
  ) {
    await Promise.all(
      attendance.map((a) =>
        StaffAttendanceModel.updateOne(
          { schoolId, staffId: a.staffId, date },
          { $set: { schoolId, staffId: a.staffId, date, status: a.status, timeIn: a.timeIn, timeOut: a.timeOut, remarks: a.remarks } },
          { upsert: true },
        ),
      ),
    );
    return { saved: attendance.length };
  },

  async lock(schoolId: string, date: string) {
    await StaffAttendanceLockModel.updateOne({ schoolId, date }, { $set: { schoolId, date, locked: true } }, { upsert: true });
    return { success: true };
  },

  async report(schoolId: string) {
    const staff = await StaffModel.find({ schoolId }).lean();
    const records = await StaffAttendanceModel.find({ schoolId }).lean();
    const byStaff = new Map<string, typeof records>();
    for (const r of records) {
      const k = String(r.staffId);
      if (!byStaff.has(k)) byStaff.set(k, []);
      byStaff.get(k)!.push(r);
    }
    return staff.map((s) => {
      const recs = byStaff.get(String(s._id)) ?? [];
      const count = (st: string) => recs.filter((r) => r.status === st).length;
      const present = count('present');
      const workingDays = recs.length;
      return {
        id: String(s._id),
        employeeId: s.employeeId,
        name: s.name,
        designation: s.designationLabel ?? s.designation ?? '',
        department: s.department ?? '',
        workingDays,
        present,
        absent: count('absent'),
        leave: count('leave'),
        halfDay: count('half_day'),
        late: count('late'),
        percentage: workingDays ? round((present / workingDays) * 100) : 0,
      };
    });
  },
};
