import { Types } from 'mongoose';

import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { ExamMarkModel } from '../exams/exams.models';
import { ReceiptModel } from '../fee/fee.models';
import { SchoolModel } from '../school/school.model';
import { StaffLeaveApplicationModel } from '../staff/staff-hr.models';
import { StaffModel } from '../staff/staff.models';
import { StudentModel } from '../students/student.model';
import { StudentTransportModel } from '../transport/transport.models';
import type { ReportData } from './reports.service';

export const SCHOOL_REPORT_KEYS = ['academic', 'fee', 'attendance', 'hr', 'transport', 'custom'] as const;

const TITLES: Record<string, { title: string; subtitle: string }> = {
  academic: { title: 'Academic', subtitle: 'Exam results, marks, performance.' },
  fee: { title: 'Fee', subtitle: 'Collection, defaulters, reconciliation.' },
  attendance: { title: 'Attendance', subtitle: 'Class + staff attendance trends.' },
  hr: { title: 'HR / Payroll', subtitle: 'Staff list, salary, leave.' },
  transport: { title: 'Transport', subtitle: 'Routes, GPS, fee status.' },
  custom: { title: 'Custom report', subtitle: 'Student directory snapshot.' },
};

async function requireSchoolName(schoolId: string): Promise<string> {
  const school = await SchoolModel.findById(schoolId).select('name').lean();
  if (!school) throw ApiError.notFound('School not found');
  return school.name;
}

async function academic(schoolId: string): Promise<ReportData> {
  const marks = await ExamMarkModel.find({ schoolId, isAbsent: false }).lean();
  const byStudent = new Map<string, { total: number; count: number }>();
  for (const m of marks) {
    const key = String(m.studentId);
    const scored = Number(m.theory ?? 0) + Number(m.practical ?? 0) + Number(m.internal ?? 0);
    const cur = byStudent.get(key) ?? { total: 0, count: 0 };
    cur.total += scored;
    cur.count += 1;
    byStudent.set(key, cur);
  }
  const studentIds = [...byStudent.keys()];
  const students = await StudentModel.find({ _id: { $in: studentIds } })
    .select('name className section')
    .lean();
  const rows = students
    .map((s) => {
      const agg = byStudent.get(String(s._id))!;
      return [
        s.name,
        `${s.className}-${s.section}`,
        agg.count,
        Math.round(agg.total / agg.count),
      ] as (string | number)[];
    })
    .sort((a, b) => Number(b[3]) - Number(a[3]));

  return { ...TITLES.academic!, columns: ['Student', 'Class', 'Exams appeared', 'Avg marks/subject'], rows };
}

async function fee(schoolId: string): Promise<ReportData> {
  const [receipts, students] = await Promise.all([
    ReceiptModel.find({ schoolId, status: 'active' }).select('className amount').lean(),
    StudentModel.find({ schoolId }).select('className feeStatus').lean(),
  ]);
  const byClass = new Map<string, { collected: number; defaulters: number; total: number }>();
  for (const r of receipts) {
    const key = r.className || 'Unassigned';
    const cur = byClass.get(key) ?? { collected: 0, defaulters: 0, total: 0 };
    cur.collected += Number(r.amount ?? 0);
    byClass.set(key, cur);
  }
  for (const s of students) {
    const key = s.className || 'Unassigned';
    const cur = byClass.get(key) ?? { collected: 0, defaulters: 0, total: 0 };
    cur.total += 1;
    if (s.feeStatus === 'pending' || s.feeStatus === 'partial') cur.defaulters += 1;
    byClass.set(key, cur);
  }
  const rows = [...byClass.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([className, v]) => [className, v.total, `₹${v.collected.toLocaleString('en-IN')}`, v.defaulters]);

  return { ...TITLES.fee!, columns: ['Class', 'Students', 'Collected', 'Defaulters'], rows };
}

async function attendance(schoolId: string): Promise<ReportData> {
  // Report on the most recent month the school actually has attendance
  // data for, not the server's real wall-clock month — attendance is
  // marked against the school's own academic-year dates, which won't
  // generally line up with "today" (e.g. seeded historical demo data).
  const latest = await AttendanceModel.findOne({ schoolId }).sort({ date: -1 }).select('date').lean();
  if (!latest) {
    return { ...TITLES.attendance!, columns: ['Class', 'Records this month', 'Present', 'Attendance %'], rows: [] };
  }
  const monthPrefix = latest.date.slice(0, 7);
  const rows = await AttendanceModel.aggregate<{ _id: { className: string; section: string }; present: number; total: number }>([
    // aggregate $match does not auto-cast like Mongoose's query builder does
    // — schoolId must be cast to ObjectId explicitly or this never matches.
    { $match: { schoolId: new Types.ObjectId(schoolId), date: { $regex: `^${monthPrefix}` } } },
    {
      $group: {
        _id: { className: '$className', section: '$section' },
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);
  const out = rows
    .sort((a, b) => (a._id.className < b._id.className ? -1 : 1))
    .map((r) => [
      `${r._id.className}-${r._id.section}`,
      r.total,
      r.present,
      r.total ? `${Math.round((r.present / r.total) * 100)}%` : '0%',
    ]);

  return {
    title: TITLES.attendance!.title,
    subtitle: `Class + staff attendance trends — ${monthPrefix}.`,
    columns: ['Class', 'Records', 'Present', 'Attendance %'],
    rows: out,
  };
}

async function hr(schoolId: string): Promise<ReportData> {
  const staff = await StaffModel.find({ schoolId }).select('name designationLabel netSalary employeeId').lean();
  const leaveDays = await StaffLeaveApplicationModel.aggregate<{ _id: string; days: number }>([
    { $match: { schoolId: new Types.ObjectId(schoolId), status: 'approved' } },
    { $group: { _id: '$staffId', days: { $sum: '$days' } } },
  ]);
  const leaveByStaff = new Map(leaveDays.map((l) => [l._id, l.days]));

  const rows = staff.map((s) => [
    s.name,
    s.designationLabel || '—',
    `₹${Number(s.netSalary ?? 0).toLocaleString('en-IN')}`,
    leaveByStaff.get(String(s._id)) ?? 0,
  ]);

  return { ...TITLES.hr!, columns: ['Staff', 'Designation', 'Net salary', 'Leave days taken'], rows };
}

async function transport(schoolId: string): Promise<ReportData> {
  const rows = await StudentTransportModel.find({ schoolId })
    .select('studentName className routeName monthlyFee paymentStatus')
    .lean();
  return {
    ...TITLES.transport!,
    columns: ['Student', 'Class', 'Route', 'Monthly fee', 'Payment status'],
    rows: rows.map((r) => [
      r.studentName,
      r.className,
      r.routeName || '—',
      `₹${Number(r.monthlyFee ?? 0).toLocaleString('en-IN')}`,
      r.paymentStatus,
    ]),
  };
}

async function custom(schoolId: string): Promise<ReportData> {
  const students = await StudentModel.find({ schoolId })
    .select('name admissionNumber className section feeStatus mobile')
    .sort({ className: 1, section: 1 })
    .lean();
  return {
    ...TITLES.custom!,
    columns: ['Admission no.', 'Student', 'Class', 'Fee status', 'Mobile'],
    rows: students.map((s) => [s.admissionNumber, s.name, `${s.className}-${s.section}`, s.feeStatus, s.mobile || '—']),
  };
}

export const schoolReportsService = {
  async getReport(schoolId: string, key: string): Promise<ReportData> {
    await requireSchoolName(schoolId);
    switch (key) {
      case 'academic':
        return academic(schoolId);
      case 'fee':
        return fee(schoolId);
      case 'attendance':
        return attendance(schoolId);
      case 'hr':
        return hr(schoolId);
      case 'transport':
        return transport(schoolId);
      case 'custom':
        return custom(schoolId);
      default:
        throw ApiError.notFound('Unknown report');
    }
  },
};
