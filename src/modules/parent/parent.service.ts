import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { CircularModel } from '../communication/communication.models';
import { ReceiptModel } from '../fee/fee.models';
import { MONTH_ABBR_TO_FULL, annualByClass } from '../fee/fee.service';
import { StudentModel } from '../students/student.model';
import { UserModel } from '../user/user.model';
import { ParentComplaintModel } from './parent.models';

const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);
type Doc = Record<string, unknown> & { _id: unknown };

/** Resolve the guardian mobiles for the logged-in parent user. */
async function guardianMobile(userId: string): Promise<string> {
  const u = await UserModel.findById(userId).lean();
  const mobile = (u?.mobile as string) ?? '';
  if (!mobile) throw ApiError.forbidden('Parent has no linked mobile');
  return mobile;
}

/** All students linked to this parent (father/mother/guardian mobile match). */
async function childrenOf(schoolId: string, userId: string): Promise<Doc[]> {
  const mobile = await guardianMobile(userId);
  return StudentModel.find({
    schoolId,
    $or: [
      { 'parents.fatherMobile': mobile },
      { 'parents.motherMobile': mobile },
      { 'parents.guardianMobile': mobile },
    ],
  }).lean() as unknown as Promise<Doc[]>;
}

/** Ownership gate — a parent may only read their OWN child's data. */
async function ownChild(schoolId: string, userId: string, childId: string): Promise<Doc> {
  const kids = await childrenOf(schoolId, userId);
  const child = kids.find((k) => String(k._id) === childId);
  if (!child) throw ApiError.notFound('Child not found for this parent');
  return child;
}

async function todayStatus(schoolId: string, studentId: string): Promise<string> {
  const rec = await AttendanceModel.findOne({ schoolId, studentId, date: today() }).lean();
  return (rec?.status as string) ?? 'not_marked';
}

export const parentService = {
  async getChildren(schoolId: string, userId: string) {
    const kids = await childrenOf(schoolId, userId);
    return Promise.all(
      kids.map(async (k) => ({
        id: String(k._id),
        name: k.name as string,
        className: (k.className as string) ?? '',
        section: (k.section as string) ?? '',
        admissionNumber: (k.admissionNumber as string) ?? '',
        session: (k.sessionLabel as string) ?? '',
        todayAttendance: await todayStatus(schoolId, String(k._id)),
      })),
    );
  },

  async getFeeSummary(schoolId: string, userId: string, childId: string) {
    const child = await ownChild(schoolId, userId, childId);
    const session = (child.sessionLabel as string) ?? '';
    const annual = await annualByClass(schoolId, session);
    const total = annual[(child.className as string) ?? ''] ?? 0;
    const receipts = await ReceiptModel.find({ schoolId, studentId: childId, status: 'active' })
      .sort({ paymentDate: -1 })
      .lean();
    const paid = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const last = receipts[0];
    return {
      totalThisSession: total,
      paid,
      balanceDue: Math.max(total - paid, 0),
      lastPayment: last ? { date: (last.paymentDate as string) ?? '', amount: Number(last.amount ?? 0) } : undefined,
    };
  },

  async getFeeMonthly(schoolId: string, userId: string, childId: string) {
    const child = await ownChild(schoolId, userId, childId);
    const session = (child.sessionLabel as string) ?? '';
    // Annual total ÷ 12 mirrors the admin Fee Collection screen's per-month
    // figure (fee.service.ts's `annualByClass`) — a monthly-only filter here
    // previously dropped quarterly/half-yearly/yearly fee heads entirely.
    const annual = await annualByClass(schoolId, session);
    const monthlyDue = Math.round((annual[(child.className as string) ?? ''] ?? 0) / 12);
    const receipts = await ReceiptModel.find({ schoolId, studentId: childId, status: 'active' }).lean();

    // Session months: Apr → Mar. Receipts store the FULL month name in
    // `monthsCovered` — match on that, not the short label used for display.
    // Reuses the same abbreviation→full-name map fee.service.ts's own
    // month-scoped ledger uses, so both stay in sync if it ever changes.
    const shortMonths = Object.keys(MONTH_ABBR_TO_FULL);
    const startYear = Number((session.split('-')[0] || '2025').slice(0, 4)) || 2025;
    return shortMonths.map((m, i) => {
      const label = `${m} ${i < 9 ? startYear : startYear + 1}`;
      const covering = receipts.filter((r) => ((r.monthsCovered as string[]) ?? []).includes(MONTH_ABBR_TO_FULL[m]!));
      const amountPaid = covering.reduce((s, r) => {
        const spread = ((r.monthsCovered as string[]) ?? []).length || 1;
        return s + Number(r.amount ?? 0) / spread;
      }, 0);
      const receipt = covering[0];
      const status = amountPaid >= monthlyDue && monthlyDue > 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'pending';
      return {
        month: label,
        amountDue: monthlyDue,
        amountPaid: Math.round(amountPaid),
        status,
        receiptNumber: receipt ? (receipt.receiptNumber as string) : undefined,
        paidOn: receipt ? (receipt.paymentDate as string) : undefined,
      };
    });
  },

  async getAttendance(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const records = await AttendanceModel.find({ schoolId, studentId: childId }).sort({ date: -1 }).lean();
    return records.map((r) => ({ date: r.date as string, status: r.status as string }));
  },

  async getCirculars(schoolId: string) {
    const circulars = await CircularModel.find({
      schoolId,
      status: 'published',
      audience: { $in: ['all', 'parents', 'parent'] },
    })
      .sort({ dateOfIssue: -1 })
      .lean();
    return circulars.map((c) => {
      const audience = (c.audience as string[]) ?? [];
      const scope = audience.includes('parents') || audience.includes('parent') ? 'parents' : audience.includes('class') ? 'class' : 'all';
      return {
        id: String(c._id),
        title: c.title as string,
        body: (c.body as string) ?? '',
        publishedAt: (c.dateOfIssue as string) || (c.createdAt as Date)?.toISOString?.() || '',
        audience: scope,
      };
    });
  },

  async getComplaints(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const rows = await ParentComplaintModel.find({ schoolId, studentId: childId }).sort({ submittedAt: -1 }).lean();
    return rows.map((r) => ({
      id: String(r._id),
      subject: r.subject as string,
      category: r.category as string,
      description: r.description as string,
      submittedAt: r.submittedAt as string,
      status: r.status as string,
      resolution: r.resolution as string | undefined,
    }));
  },

  async submitComplaint(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const childId = String(payload.childId);
    await ownChild(schoolId, userId, childId);
    const doc = await ParentComplaintModel.create({
      schoolId,
      studentId: childId,
      guardianUserId: userId,
      subject: payload.subject,
      category: payload.category,
      description: payload.description,
      submittedAt: nowIso(),
      status: 'submitted',
    });
    const r = doc.toObject();
    return {
      id: String(r._id),
      subject: r.subject,
      category: r.category,
      description: r.description,
      submittedAt: r.submittedAt,
      status: r.status,
    };
  },
};
