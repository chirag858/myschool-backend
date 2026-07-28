import { ApiError } from '../../lib/api-error';
import { StaffModel } from './staff.models';
import {
  PayrollSlipModel,
  SalaryAdvanceModel,
  StaffActivityModel,
  StaffDocumentModel,
  StaffExitModel,
  StaffLeaveApplicationModel,
} from './staff-hr.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const LEAVE_ALLOTMENT: Record<string, number> = { casual: 12, sick: 10, earned: 15, maternity: 90, paternity: 15, other: 5 };

async function requireStaff(schoolId: string, staffId: string): Promise<Doc> {
  const s = await StaffModel.findOne({ _id: staffId, schoolId });
  if (!s) throw ApiError.notFound('Staff not found');
  return s as unknown as Doc;
}

export const staffHrService = {
  // ─── Leave ───
  async getLeaveBalance(schoolId: string, staffId: string) {
    const approved = await StaffLeaveApplicationModel.find({ schoolId, staffId, status: 'approved' }).lean();
    return Object.entries(LEAVE_ALLOTMENT).map(([type, allotted]) => {
      const used = approved.filter((l) => l.type === type).reduce((s, l) => s + Number(l.days ?? 0), 0);
      return { type, allotted, used, remaining: Math.max(allotted - used, 0) };
    });
  },

  async getLeaveHistory(schoolId: string, staffId: string) {
    const rows = await StaffLeaveApplicationModel.find({ schoolId, staffId }).sort({ appliedOn: -1 }).lean();
    return rows.map((r) => ({
      id: String(r._id),
      type: r.type,
      fromDate: r.fromDate,
      toDate: r.toDate,
      days: r.days,
      reason: r.reason,
      appliedOn: r.appliedOn,
      status: r.status,
      substituteTeacherName: r.substituteTeacherName,
      currentLevel: r.currentLevel,
      history: r.history ?? [],
    }));
  },

  async applyLeave(schoolId: string, staffId: string, payload: Record<string, unknown>) {
    await requireStaff(schoolId, staffId);
    const doc = await StaffLeaveApplicationModel.create({
      schoolId,
      staffId,
      type: payload.type,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      days: Number(payload.days ?? 1),
      reason: payload.reason,
      substituteTeacherName: payload.substituteTeacherName,
      appliedOn: nowIso(),
      status: 'pending',
      currentLevel: 1,
      history: [],
    });
    const r = doc.toObject();
    return {
      id: String(r._id),
      type: r.type,
      fromDate: r.fromDate,
      toDate: r.toDate,
      days: r.days,
      reason: r.reason,
      appliedOn: r.appliedOn,
      status: r.status,
      substituteTeacherName: r.substituteTeacherName,
      currentLevel: r.currentLevel,
      history: r.history ?? [],
    };
  },

  async reviewLeave(schoolId: string, leaveId: string, action: 'approve' | 'reject', remarks: string) {
    const leave = await StaffLeaveApplicationModel.findOne({ _id: leaveId, schoolId });
    if (!leave) throw ApiError.notFound('Leave not found');
    const level = (leave.currentLevel as number) ?? 1;
    const history = [...((leave.history as unknown[]) ?? []), { level, actor: 'Reviewer', action: action === 'approve' ? 'approved' : 'rejected', remarks, at: nowIso() }];
    let status: string;
    if (action === 'reject') {
      status = 'rejected';
      leave.set({ status, history });
    } else if (level >= 3) {
      status = 'approved';
      leave.set({ status, history });
    } else {
      // Escalate to the next approval level; stays pending.
      status = 'pending';
      leave.set({ currentLevel: level + 1, history });
    }
    await leave.save();
    return { status };
  },

  // ─── Salary (embedded on the staff doc so getProfile reflects it) ───
  async reviseSalary(schoolId: string, staffId: string, payload: { newBasic: number; reason: string }) {
    const staff = await requireStaff(schoolId, staffId);
    const oldBasic = Number((staff as { basic?: number }).basic ?? 0);
    const revisions = [...(((staff as { salaryRevisions?: unknown[] }).salaryRevisions) ?? [])];
    revisions.unshift({
      id: `rev_${revisions.length + 1}`,
      date: nowIso().slice(0, 10),
      oldBasic,
      newBasic: payload.newBasic,
      revisedBy: 'Admin',
      reason: payload.reason,
    });
    (staff as unknown as { basic: number; salaryRevisions: unknown[] }).basic = payload.newBasic;
    (staff as unknown as { salaryRevisions: unknown[] }).salaryRevisions = revisions;
    await (staff as unknown as { save: () => Promise<unknown> }).save();
    return { ok: true as const };
  },

  async saveSalaryStructure(schoolId: string, staffId: string, structure: Record<string, unknown>) {
    const r = await StaffModel.updateOne({ _id: staffId, schoolId }, { $set: { salaryStructure: structure, basic: structure.basic } });
    if (!r.matchedCount) throw ApiError.notFound('Staff not found');
  },

  async getStaffPayrollHistory(schoolId: string, staffId: string) {
    const rows = await PayrollSlipModel.find({ schoolId, staffId }).sort({ year: -1, month: -1 }).lean();
    return rows.map((r) => ({
      id: String(r._id),
      month: r.month,
      year: r.year,
      basic: r.basic,
      gross: r.gross,
      deductions: Number(r.absentDeduction ?? 0) + Number(r.otherDeductions ?? 0),
      netPaid: r.netPayable,
      paymentDate: r.paymentDate,
      paymentMode: r.paymentMode,
      status: r.status === 'advance_adjusted' ? 'paid' : r.status,
    }));
  },

  // ─── Documents ───
  async getStaffDocuments(schoolId: string, staffId: string) {
    const rows = await StaffDocumentModel.find({ schoolId, staffId }).sort({ uploadedAt: -1 }).lean();
    return rows.map((d) => ({
      id: String(d._id),
      category: d.category,
      fileName: d.fileName,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
      uploadedBy: d.uploadedBy,
    }));
  },

  async uploadDocument(schoolId: string, staffId: string, payload: { category: string; fileName: string; sizeBytes: number }) {
    await requireStaff(schoolId, staffId);
    const doc = await StaffDocumentModel.create({
      schoolId,
      staffId,
      category: payload.category,
      fileName: payload.fileName,
      sizeBytes: payload.sizeBytes,
      uploadedAt: nowIso(),
      uploadedBy: 'Admin',
    });
    const d = doc.toObject();
    return { id: String(d._id), category: d.category, fileName: d.fileName, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy };
  },

  async generateHRDocument(schoolId: string, payload: { staffId: string; documentType: string }) {
    await requireStaff(schoolId, payload.staffId);
    const generatedAt = nowIso();
    const referenceNumber = `HR-${generatedAt.slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const doc = await StaffDocumentModel.create({
      schoolId,
      staffId: payload.staffId,
      category: payload.documentType,
      fileName: `${payload.documentType}-${generatedAt.slice(0, 10)}.pdf`,
      sizeBytes: 96_000,
      referenceNumber,
      uploadedAt: generatedAt,
      uploadedBy: 'HR System',
    });
    return { id: String(doc._id), referenceNumber, generatedAt };
  },

  // ─── Activity ───
  async getStaffActivity(schoolId: string, staffId: string) {
    const rows = await StaffActivityModel.find({ schoolId, staffId }).sort({ timestamp: -1 }).lean();
    return rows.map((r) => ({
      id: String(r._id),
      timestamp: r.timestamp,
      action: r.action,
      performedBy: r.performedBy,
      module: r.module,
      details: r.details,
    }));
  },

  // ─── Payroll (org level) ───
  async getPayrollKpi(schoolId: string) {
    const slips = await PayrollSlipModel.find({ schoolId }).lean();
    return {
      totalPayroll: slips.reduce((s, r) => s + Number(r.netPayable ?? 0), 0),
      paidCount: slips.filter((r) => r.status === 'paid' || r.status === 'advance_adjusted').length,
      pendingCount: slips.filter((r) => r.status === 'pending').length,
      totalDeductions: slips.reduce((s, r) => s + Number(r.absentDeduction ?? 0) + Number(r.otherDeductions ?? 0), 0),
    };
  },

  slipView(r: Doc): Record<string, unknown> {
    return {
      id: String(r._id),
      staffId: r.staffId,
      employeeId: r.employeeId,
      name: r.name,
      designation: r.designation,
      basic: r.basic,
      allowances: r.allowances,
      gross: r.gross,
      absentDeduction: r.absentDeduction,
      otherDeductions: r.otherDeductions,
      netPayable: r.netPayable,
      status: r.status,
      paymentDate: r.paymentDate,
      paymentMode: r.paymentMode,
      reference: r.reference,
      holdReason: r.holdReason,
    };
  },

  payrollStatus(rows: Doc[]): string {
    if (rows.length === 0) return 'not_generated';
    const paid = rows.filter((r) => r.status === 'paid' || r.status === 'advance_adjusted').length;
    return paid === rows.length ? 'fully_paid' : paid === 0 ? 'generated' : 'partially_paid';
  },

  async getPayroll(schoolId: string, month: string, year: number) {
    const rows = (await PayrollSlipModel.find({ schoolId, month, year }).lean()) as unknown as Doc[];
    return { month, year, status: this.payrollStatus(rows), rows: rows.map((r) => this.slipView(r)), attendanceFinalized: rows.length > 0 };
  },

  async generatePayroll(schoolId: string, month: string, year: number) {
    const staff = await StaffModel.find({ schoolId, status: 'active' }).lean();
    for (const s of staff) {
      const basic = Number(s.basic ?? 0);
      const allowances = Math.round(basic * 0.3);
      const gross = basic + allowances;
      const otherDeductions = Math.round(basic * 0.12);
      const netPayable = gross - otherDeductions;
      await PayrollSlipModel.findOneAndUpdate(
        { schoolId, staffId: String(s._id), month, year },
        {
          schoolId,
          staffId: String(s._id),
          employeeId: s.employeeId,
          name: s.name,
          designation: (s.designationLabel as string) || (s.designation as string),
          month,
          year,
          basic,
          allowances,
          gross,
          absentDeduction: 0,
          otherDeductions,
          netPayable,
          status: 'pending',
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    return this.getPayroll(schoolId, month, year);
  },

  async markPaid(schoolId: string, slipId: string, payload: { paymentDate: string; paymentMode: string; reference: string }) {
    const doc = await PayrollSlipModel.findOneAndUpdate(
      { _id: slipId, schoolId },
      { $set: { status: 'paid', paymentDate: payload.paymentDate, paymentMode: payload.paymentMode, reference: payload.reference } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Payroll slip not found');
    return this.slipView(doc.toObject() as Doc);
  },

  async putOnHold(schoolId: string, slipId: string, reason: string) {
    const doc = await PayrollSlipModel.findOneAndUpdate(
      { _id: slipId, schoolId },
      { $set: { status: 'on_hold', holdReason: reason } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Payroll slip not found');
    return this.slipView(doc.toObject() as Doc);
  },

  // ─── Salary advances ───
  advanceRequestView(r: Doc): Record<string, unknown> {
    return {
      id: String(r._id),
      staffId: r.staffId,
      staffName: r.staffName,
      amountRequested: r.amountRequested,
      reason: r.reason,
      requestDate: r.requestDate,
      repaymentMonths: r.repaymentMonths,
      monthlyRecovery: r.monthlyRecovery,
      status: r.status,
    };
  },

  async getAdvanceRequests(schoolId: string) {
    return (await SalaryAdvanceModel.find({ schoolId }).sort({ requestDate: -1 }).lean()).map((r) => this.advanceRequestView(r as unknown as Doc));
  },

  async createAdvanceRequest(schoolId: string, payload: Record<string, unknown>) {
    const doc = await SalaryAdvanceModel.create({
      schoolId,
      staffId: payload.staffId,
      staffName: payload.staffName,
      amountRequested: Number(payload.amountRequested ?? 0),
      reason: payload.reason,
      requestDate: nowIso().slice(0, 10),
      repaymentMonths: Number(payload.repaymentMonths ?? 1),
      monthlyRecovery: Number(payload.monthlyRecovery ?? 0),
      status: 'pending',
    });
    return this.advanceRequestView(doc.toObject() as Doc);
  },

  async reviewAdvanceRequest(schoolId: string, id: string, action: 'approve' | 'reject') {
    const doc = await SalaryAdvanceModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { status: action === 'approve' ? 'approved' : 'rejected', activeStatus: 'active', recoveredSoFar: 0 } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Advance request not found');
    return this.advanceRequestView(doc.toObject() as Doc);
  },

  async getActiveAdvances(schoolId: string) {
    const rows = await SalaryAdvanceModel.find({ schoolId, status: 'approved' }).lean();
    return rows.map((r) => ({
      id: String(r._id),
      staffId: r.staffId,
      staffName: r.staffName,
      totalAdvance: r.amountRequested,
      recoveredSoFar: r.recoveredSoFar ?? 0,
      remaining: Number(r.amountRequested ?? 0) - Number(r.recoveredSoFar ?? 0),
      monthlyRecovery: r.monthlyRecovery,
      status: (r.activeStatus as string) ?? 'active',
    }));
  },

  // ─── Exit management ───
  exitView(r: Doc): Record<string, unknown> {
    return {
      id: String(r._id),
      staffId: r.staffId,
      staffName: r.staffName,
      exitType: r.exitType,
      lastWorkingDate: r.lastWorkingDate,
      noticePeriodDays: r.noticePeriodDays,
      reason: r.reason,
      handoverNotes: r.handoverNotes,
      settlementAmount: r.settlementAmount,
      clearanceItems: r.clearanceItems ?? [],
      remarks: r.remarks,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
    };
  },

  async submitExit(schoolId: string, staffId: string, payload: Record<string, unknown>) {
    const staff = await requireStaff(schoolId, staffId);
    const doc = await StaffExitModel.create({
      schoolId,
      staffId,
      staffName: (staff as { name?: string }).name ?? '—',
      exitType: payload.exitType,
      lastWorkingDate: payload.lastWorkingDate,
      noticePeriodDays: Number(payload.noticePeriodDays ?? 0),
      reason: payload.reason,
      handoverNotes: payload.handoverNotes,
      settlementAmount: payload.settlementAmount,
      clearanceItems: payload.clearanceItems ?? [],
      remarks: payload.remarks,
      createdAt: nowIso(),
      createdBy: 'Admin',
    });
    await StaffModel.updateOne({ _id: staffId, schoolId }, { $set: { status: payload.exitType === 'termination' ? 'terminated' : 'relieved' } });
    return this.exitView(doc.toObject() as Doc);
  },

  async getExitRecord(schoolId: string, staffId: string) {
    const doc = await StaffExitModel.findOne({ schoolId, staffId }).lean();
    return doc ? this.exitView(doc as unknown as Doc) : null;
  },

  calculateNoticePeriod(employmentType: string) {
    // 'full_time' and 'permanent' are the same concept — both get 60 days.
    const noticeDays =
      employmentType === 'permanent' || employmentType === 'full_time' ? 60
      : employmentType === 'probation' ? 30
      : employmentType === 'contract' ? 15
      : 30; // part_time + fallback
    return { noticeDays };
  },
};
