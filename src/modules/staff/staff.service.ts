import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { clearInchargeSection, getInchargeSection, setInchargeSection } from '../academics/academics.service';
import { ApiError } from '../../lib/api-error';
import { UserModel } from '../user/user.model';
import { StaffAttendanceLockModel, StaffAttendanceModel, StaffModel } from './staff.models';

interface CredentialsDoc {
  _id: unknown;
  username?: string;
  email?: string;
  role: string;
  active?: boolean;
  assignedClasses?: string[];
}
async function credentialsDto(schoolId: string, user: CredentialsDoc): Promise<Record<string, unknown>> {
  const inchargeSection = user.role === 'teacher' ? await getInchargeSection(schoolId, String(user._id)) : null;
  return {
    hasLogin: true,
    userId: String(user._id),
    username: user.username ?? '',
    email: user.email ?? '',
    role: user.role,
    active: user.active ?? true,
    ...(user.role === 'coordinator' ? { assignedClasses: user.assignedClasses ?? [] } : {}),
    ...(user.role === 'teacher' ? { inchargeClassKey: inchargeSection?.classKey ?? null } : {}),
  };
}

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
    probationEndDate: d.probationEndDate,
    reportingToName: d.reportingToName,
    reportingToId: d.reportingToId,
    workingHoursPerDay: d.workingHoursPerDay ?? 8,
    weeklyOffDays: d.weeklyOffDays ?? ['sun'],
    qualifications: d.qualifications ?? [],
    experience: d.experience ?? [],
    teachingSubjects: d.teachingSubjects ?? [],
    teachingClasses: d.teachingClasses ?? [],
    teachingExperienceYears: d.teachingExperienceYears,
    // `basic`/`netSalary` on the staff doc are the source of truth (kept in
    // sync by reviseSalary/saveSalaryStructure) — mirror `basic` into the
    // nested structure too, since staff created before a structure was ever
    // saved only have it at the top level and `salaryStructure` is otherwise
    // `{}`, which breaks anything reading `salaryStructure.basic` directly.
    salaryStructure: {
      paymentMode: 'bank',
      ...(d.salaryStructure as Record<string, unknown> | undefined ?? {}),
      basic: d.basic ?? 0,
      allowances: (d.salaryStructure as { allowances?: unknown[] } | undefined)?.allowances ?? [],
      deductions: (d.salaryStructure as { deductions?: unknown[] } | undefined)?.deductions ?? [],
    },
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
      // Derive from `department` (the field the UI edits) rather than the
      // separately-stored `category`, which can drift out of sync with it.
      teachingCount: all.filter((s) => s.department === 'teaching').length,
      nonTeachingCount: all.filter((s) => s.department !== 'teaching').length,
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
    // Derive category from department so stats() always returns correct
    // teachingCount / nonTeachingCount regardless of what the frontend sends.
    const category = payload.department === 'teaching' ? 'teaching' : 'non_teaching';
    const { allowances, deductions, paymentMode, bankAccountNumber, bankName, branch, ifsc, ...rest } = payload as {
      allowances?: { amount: number }[];
      deductions?: { amount: number }[];
      paymentMode?: string;
      bankAccountNumber?: string;
      bankName?: string;
      branch?: string;
      ifsc?: string;
      [key: string]: unknown;
    };
    const allowanceTotal = (allowances ?? []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const deductionTotal = (deductions ?? []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const doc = await StaffModel.create({
      schoolId,
      ...rest,
      employeeId,
      category,
      status: 'active',
      netSalary: round(basic + allowanceTotal - deductionTotal),
      salaryStructure: { allowances: allowances ?? [], deductions: deductions ?? [], paymentMode, bankAccountNumber, bankName, branch, ifsc },
    });
    return toRow(doc.toObject());
  },

  async updateStatus(schoolId: string, id: string, status: string) {
    const doc = await StaffModel.findOneAndUpdate({ _id: id, schoolId }, { status }, { new: true });
    if (!doc) throw ApiError.notFound('Staff not found');
    return toRow(doc.toObject());
  },

  // ── Login credentials (links this Staff record to a User login) ──
  async getCredentials(schoolId: string, staffId: string) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId }).lean();
    if (!staff) throw ApiError.notFound('Staff not found');
    if (!staff.userId) return { hasLogin: false };
    const user = await UserModel.findOne({ _id: staff.userId, schoolId }).lean();
    if (!user) return { hasLogin: false };
    return credentialsDto(schoolId, user as unknown as CredentialsDoc);
  },

  async createCredentials(
    schoolId: string,
    staffId: string,
    payload: { role: string; email: string; username?: string; password?: string },
  ) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId });
    if (!staff) throw ApiError.notFound('Staff not found');
    if (staff.userId) throw ApiError.conflict('This staff member already has a login');

    const email = payload.email.toLowerCase();
    const username = (payload.username ?? email).toLowerCase();
    const existing = await UserModel.findOne({ schoolId, $or: [{ email }, { username }] }).lean();
    if (existing) throw ApiError.conflict('A login with this email or username already exists');

    const generated = !payload.password;
    const tempPassword = payload.password ?? randomUUID().slice(0, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const user = await UserModel.create({
      name: staff.name,
      username,
      email,
      mobile: staff.mobile,
      role: payload.role,
      passwordHash,
      schoolId,
      active: true,
    });
    staff.userId = user._id;
    await staff.save();

    return {
      ...(await credentialsDto(schoolId, user.toObject() as unknown as CredentialsDoc)),
      ...(generated ? { tempPassword } : {}),
    };
  },

  async updateCredentials(schoolId: string, staffId: string, patch: { role?: string; active?: boolean }) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId }).lean();
    if (!staff?.userId) throw ApiError.notFound('No login found for this staff member');
    const user = await UserModel.findOneAndUpdate(
      { _id: staff.userId, schoolId },
      { $set: patch },
      { new: true },
    ).lean();
    if (!user) throw ApiError.notFound('No login found for this staff member');
    return credentialsDto(schoolId, user as unknown as CredentialsDoc);
  },

  // ── Class incharge (single class per teacher, mirrors Section.classTeacherId) ──
  async getIncharge(schoolId: string, staffId: string) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId }).lean();
    if (!staff) throw ApiError.notFound('Staff not found');
    if (!staff.userId) return null;
    return getInchargeSection(schoolId, String(staff.userId));
  },

  async setIncharge(schoolId: string, staffId: string, sectionId: string) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId }).lean();
    if (!staff?.userId) throw ApiError.notFound('No login found for this staff member');
    const user = await UserModel.findOne({ _id: staff.userId, schoolId }).lean();
    if (!user) throw ApiError.notFound('No login found for this staff member');
    if (user.role !== 'teacher') throw ApiError.badRequest('Only a teacher can be a class incharge');
    return setInchargeSection(schoolId, sectionId, String(staff.userId), user.name ?? staff.name);
  },

  async clearIncharge(schoolId: string, staffId: string) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId }).lean();
    if (!staff?.userId) throw ApiError.notFound('No login found for this staff member');
    await clearInchargeSection(schoolId, String(staff.userId));
    return { success: true };
  },

  async resetPassword(schoolId: string, staffId: string, password?: string) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId }).lean();
    if (!staff?.userId) throw ApiError.notFound('No login found for this staff member');
    const generated = !password;
    const tempPassword = password ?? randomUUID().slice(0, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const user = await UserModel.findOneAndUpdate({ _id: staff.userId, schoolId }, { $set: { passwordHash } }, { new: true }).lean();
    if (!user) throw ApiError.notFound('No login found for this staff member');
    return generated ? { tempPassword } : { ok: true };
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

  async getAttendanceMonth(schoolId: string, staffId: string, month: number, year: number) {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();
    const start = `${year}-${pad(month)}-01`;
    const end = `${year}-${pad(month)}-${pad(daysInMonth)}`;
    const records = await StaffAttendanceModel.find({ schoolId, staffId, date: { $gte: start, $lte: end } }).lean();
    const byDate = new Map(records.map((r) => [r.date, r.status]));

    let present = 0;
    let absent = 0;
    let leave = 0;
    let halfDay = 0;
    let workingDays = 0;
    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${pad(month)}-${pad(day)}`;
      const recorded = byDate.get(date);
      const isWeekend = new Date(year, month - 1, day).getDay() % 6 === 0;
      const status = recorded ?? (isWeekend ? 'weekend' : 'holiday');
      if (recorded) {
        workingDays += 1;
        if (recorded === 'present') present += 1;
        else if (recorded === 'absent') absent += 1;
        else if (recorded === 'leave') leave += 1;
        else if (recorded === 'half_day') halfDay += 1;
      }
      days.push({ date, status });
    }
    return {
      year,
      month,
      workingDays,
      present,
      absent,
      leave,
      halfDay,
      percentage: workingDays ? round((present / workingDays) * 100) : 0,
      days,
    };
  },
};
