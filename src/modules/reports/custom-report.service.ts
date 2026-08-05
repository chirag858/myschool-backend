import { Types } from 'mongoose';

import { ApiError } from '../../lib/api-error';
import { getActiveSessionName } from '../academics/academics.service';
import { AttendanceModel } from '../attendance/attendance.models';
import { computeClassRows } from '../exams/exams.service';
import { ExamModel } from '../exams/exams.models';
import { annualByClass } from '../fee/fee.service';
import { ReceiptModel } from '../fee/fee.models';
import { HostelStudentModel } from '../hostel/hostel.models';
import { IssueModel } from '../library/library.models';
import { StaffModel } from '../staff/staff.models';
import { StudentModel } from '../students/student.model';
import { StudentTransportModel } from '../transport/transport.models';
import type { ReportData } from './reports.service';

export const CUSTOM_REPORT_SOURCES = [
  'students',
  'staff',
  'fee',
  'attendance',
  'examinations',
  'transport',
  'hostel',
  'library',
] as const;
export type CustomReportSource = (typeof CUSTOM_REPORT_SOURCES)[number];

export const FIELDS_BY_SOURCE: Record<CustomReportSource, readonly string[]> = {
  students: [
    'name', 'admissionNo', 'class', 'section', 'dob', 'gender', 'category',
    'fatherName', 'motherName', 'mobile', 'email',
    'totalFee', 'paid', 'balance', 'feeStatus',
    'presentPercent', 'totalPresent', 'totalAbsent',
  ],
  staff: ['name', 'employeeId', 'department', 'designation', 'mobile', 'basic', 'allowances', 'deductions', 'net'],
  fee: ['student', 'amount', 'paymentDate', 'mode'],
  attendance: ['student', 'class', 'date', 'status'],
  examinations: ['exam', 'class', 'student', 'totalMarks', 'percentage'],
  transport: ['student', 'route', 'stop', 'monthlyFee'],
  hostel: ['student', 'building', 'room', 'bed', 'fee'],
  library: ['member', 'book', 'issueDate', 'returnDate'],
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', admissionNo: 'Admission No.', class: 'Class', section: 'Section',
  dob: 'DOB', gender: 'Gender', category: 'Category',
  fatherName: "Father's Name", motherName: "Mother's Name", mobile: 'Mobile', email: 'Email',
  totalFee: 'Total Fee', paid: 'Paid', balance: 'Balance', feeStatus: 'Fee Status',
  presentPercent: 'Present %', totalPresent: 'Total Present', totalAbsent: 'Total Absent',
  employeeId: 'Employee ID', department: 'Department', designation: 'Designation',
  basic: 'Basic', allowances: 'Allowances', deductions: 'Deductions', net: 'Net',
  student: 'Student', amount: 'Amount', paymentDate: 'Payment Date', mode: 'Mode',
  date: 'Date', status: 'Status',
  exam: 'Exam', totalMarks: 'Total Marks', percentage: 'Percentage %',
  route: 'Route', stop: 'Stop', monthlyFee: 'Monthly Fee',
  building: 'Building', room: 'Room', bed: 'Bed', fee: 'Fee',
  member: 'Member', book: 'Book', issueDate: 'Issue Date', returnDate: 'Return Date',
};

type Row = Record<string, string | number>;

async function fetchStudentsRows(schoolId: string): Promise<Row[]> {
  const students = await StudentModel.find({ schoolId }).lean();
  const session = await getActiveSessionName(schoolId);
  const annual = await annualByClass(schoolId, session);
  const receipts = await ReceiptModel.find({ schoolId: new Types.ObjectId(schoolId), status: 'active' })
    .select('studentId amount')
    .lean();
  const paidByStudent = new Map<string, number>();
  for (const r of receipts) {
    const sid = String(r.studentId ?? '');
    paidByStudent.set(sid, (paidByStudent.get(sid) ?? 0) + Number(r.amount ?? 0));
  }
  const attRows = await AttendanceModel.aggregate<{ _id: string; present: number; total: number }>([
    { $match: { schoolId: new Types.ObjectId(schoolId) } },
    {
      $group: {
        _id: '$studentId',
        present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);
  const attByStudent = new Map(attRows.map((a) => [String(a._id), a]));

  return students.map((s) => {
    const sid = String(s._id);
    const totalFee = annual[s.className ?? ''] ?? 0;
    const paid = paidByStudent.get(sid) ?? 0;
    const balance = Math.max(0, totalFee - paid);
    const att = attByStudent.get(sid);
    const presentPercent = att && att.total ? Math.round((att.present / att.total) * 100) : 0;
    return {
      name: s.name,
      admissionNo: s.admissionNumber,
      class: s.className ?? '',
      section: s.section ?? '',
      dob: s.dateOfBirth ?? '',
      gender: s.gender ?? '',
      category: s.category ?? '',
      fatherName: s.parents?.fatherName ?? '',
      motherName: s.parents?.motherName ?? '',
      mobile: s.mobile ?? '',
      email: s.parents?.fatherEmail || s.parents?.motherEmail || '',
      totalFee,
      paid,
      balance,
      feeStatus: s.feeStatus ?? '',
      presentPercent,
      totalPresent: att?.present ?? 0,
      totalAbsent: att ? att.total - att.present : 0,
    };
  });
}

async function fetchStaffRows(schoolId: string): Promise<Row[]> {
  const staff = await StaffModel.find({ schoolId }).lean();
  return staff.map((s) => {
    const basic = Number(s.basic ?? 0);
    const structure = s.salaryStructure as
      | { allowances?: { amount: number }[]; deductions?: { amount: number }[] }
      | undefined;
    const allowances = structure?.allowances?.length
      ? structure.allowances.reduce((sum, a) => sum + Number(a.amount ?? 0), 0)
      : Math.round(basic * 0.3);
    const deductions = structure?.deductions?.length
      ? structure.deductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0)
      : Math.round(basic * 0.12);
    const net = s.netSalary ? Number(s.netSalary) : basic + allowances - deductions;
    return {
      name: s.name,
      employeeId: s.employeeId ?? '',
      department: (s.departmentLabel as string) || (s.department as string) || '',
      designation: (s.designationLabel as string) || (s.designation as string) || '',
      mobile: s.mobile ?? '',
      basic,
      allowances,
      deductions,
      net,
    };
  });
}

async function fetchFeeRows(schoolId: string): Promise<Row[]> {
  const receipts = await ReceiptModel.find({ schoolId, status: 'active' }).lean();
  return receipts.map((r) => ({
    student: r.studentName ?? '',
    amount: Number(r.amount ?? 0),
    paymentDate: r.paymentDate ?? '',
    mode: r.paymentMode ?? '',
  }));
}

async function fetchAttendanceRows(schoolId: string): Promise<Row[]> {
  const records = await AttendanceModel.find({ schoolId }).lean();
  const studentIds = [...new Set(records.map((r) => String(r.studentId)))];
  const students = await StudentModel.find({ _id: { $in: studentIds } }).select('name').lean();
  const nameById = new Map(students.map((s) => [String(s._id), s.name]));
  return records.map((r) => ({
    student: nameById.get(String(r.studentId)) ?? '',
    class: r.className ?? '',
    date: r.date,
    status: r.status,
  }));
}

async function fetchExaminationsRows(schoolId: string): Promise<Row[]> {
  // No exam selector exists in the UI yet — default to the school's most
  // recently concluded exam, matching the same "latest" convention used by
  // the attendance/HR sources below.
  const exam = await ExamModel.findOne({ schoolId }).sort({ endDate: -1, startDate: -1 }).lean();
  if (!exam) return [];
  const classes = (exam.classes as string[] | undefined) ?? [];
  const rows: Row[] = [];
  for (const classKey of classes) {
    const classRows = await computeClassRows(schoolId, exam, classKey);
    for (const r of classRows) {
      rows.push({
        exam: (exam.name as string) ?? '',
        class: classKey,
        student: r.name,
        totalMarks: r.totalObtained,
        percentage: r.percentage,
      });
    }
  }
  return rows;
}

async function fetchTransportRows(schoolId: string): Promise<Row[]> {
  const rows = await StudentTransportModel.find({ schoolId }).lean();
  return rows.map((r) => ({
    student: r.studentName ?? '',
    route: r.routeName ?? '',
    stop: r.stopName ?? '',
    monthlyFee: Number(r.monthlyFee ?? 0),
  }));
}

async function fetchHostelRows(schoolId: string): Promise<Row[]> {
  const rows = await HostelStudentModel.find({ schoolId, status: 'allocated' }).lean();
  return rows.map((r) => ({
    student: r.studentName ?? '',
    building: r.buildingName ?? '',
    room: r.roomNumber ?? '',
    bed: r.bedNumber ?? '',
    fee: Number(r.monthlyFee ?? 0) + Number(r.messMonthlyCharge ?? 0),
  }));
}

async function fetchLibraryRows(schoolId: string): Promise<Row[]> {
  const rows = await IssueModel.find({ schoolId }).lean();
  return rows.map((r) => ({
    member: r.memberName ?? '',
    book: r.bookTitle ?? '',
    issueDate: r.issueDate ?? '',
    returnDate: r.returnDate ?? '',
  }));
}

const FETCHERS: Record<CustomReportSource, (schoolId: string) => Promise<Row[]>> = {
  students: fetchStudentsRows,
  staff: fetchStaffRows,
  fee: fetchFeeRows,
  attendance: fetchAttendanceRows,
  examinations: fetchExaminationsRows,
  transport: fetchTransportRows,
  hostel: fetchHostelRows,
  library: fetchLibraryRows,
};

export interface CustomReportFilter {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'between';
  value: string;
}

export interface CustomReportConfig {
  source: CustomReportSource;
  fields: string[];
  filters?: CustomReportFilter[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  groupBy?: string;
  maxRows?: number | 'all';
  title?: string;
  showTotals?: boolean;
}

function applyFilter(rows: Row[], f: CustomReportFilter): Row[] {
  return rows.filter((r) => {
    const raw = r[f.field];
    if (raw === undefined) return false;
    switch (f.operator) {
      case 'equals':
        return String(raw).toLowerCase() === f.value.toLowerCase();
      case 'contains':
        return String(raw).toLowerCase().includes(f.value.toLowerCase());
      case 'gt':
        return Number(raw) > Number(f.value);
      case 'lt':
        return Number(raw) < Number(f.value);
      case 'between': {
        const [lo, hi] = f.value.split(',').map(Number);
        return Number(raw) >= lo && Number(raw) <= hi;
      }
      default:
        return true;
    }
  });
}

export const customReportService = {
  async run(schoolId: string, config: CustomReportConfig): Promise<ReportData> {
    if (!CUSTOM_REPORT_SOURCES.includes(config.source)) throw ApiError.badRequest('Unknown report source');
    const validFields = FIELDS_BY_SOURCE[config.source];
    const fields = config.fields.filter((f) => validFields.includes(f));
    if (fields.length === 0) throw ApiError.badRequest('At least one valid field is required');

    let rows = await FETCHERS[config.source](schoolId);

    for (const f of config.filters ?? []) {
      if (validFields.includes(f.field)) rows = applyFilter(rows, f);
    }

    if (config.groupBy && validFields.includes(config.groupBy)) {
      const groupField = config.groupBy;
      rows = rows.slice().sort((a, b) => String(a[groupField]).localeCompare(String(b[groupField])));
    }
    if (config.sortBy && validFields.includes(config.sortBy)) {
      const sortField = config.sortBy;
      const dir = config.sortDir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const av = a[sortField];
        const bv = b[sortField];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }

    if (config.maxRows && config.maxRows !== 'all') {
      rows = rows.slice(0, Number(config.maxRows));
    }

    const columns = fields.map((f) => FIELD_LABELS[f] ?? f);
    const outRows: (string | number)[][] = rows.map((r) => fields.map((f) => r[f] ?? ''));

    if (config.showTotals && rows.length > 0) {
      const totals = fields.map((f, i) => {
        if (i === 0) return 'Total';
        const isNumeric = rows.every((r) => typeof r[f] === 'number');
        if (!isNumeric) return '';
        return rows.reduce((sum, r) => sum + Number(r[f] ?? 0), 0);
      });
      outRows.push(totals);
    }

    return {
      title: config.title?.trim() || 'Custom report',
      subtitle: `${config.source} · ${rows.length} row${rows.length === 1 ? '' : 's'}`,
      columns,
      rows: outRows,
    };
  },
};
