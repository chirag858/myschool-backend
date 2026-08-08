import { Types } from 'mongoose';
import { getActiveSessionName } from '../academics/academics.service';
import { ApiError } from '../../lib/api-error';
import { sendBulk, type MessagingChannel } from '../../lib/messaging-provider';
import { StudentModel } from '../students/student.model';
import { annualByClass } from './fee.service';
import { ReceiptModel } from './fee.models';
import {
  InstallmentPlanModel,
  ReminderLogModel,
  ReminderRuleModel,
  SiblingGroupModel,
  StudentInstallmentModel,
} from './fee-recovery.models';

type Doc = Record<string, unknown> & { _id: unknown };

const MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];

function monthDueDate(monthIndex: number, startYear: number): Date {
  // Session runs April(0)..March(11); first 9 months fall in the earlier
  // calendar year, the rest in the next — mirrors fee.service.studentContext.
  const year = monthIndex < 9 ? startYear : startYear + 1;
  const calendarMonth = (monthIndex + 3) % 12; // April(0) -> month index 3
  return new Date(year, calendarMonth, 5);
}

export function agingBucketFor(daysOverdue: number): '0_30' | '30_60' | '60_90' | '90_plus' {
  if (daysOverdue < 30) return '0_30';
  if (daysOverdue < 60) return '30_60';
  if (daysOverdue < 90) return '60_90';
  return '90_plus';
}

/** Live-computed defaulter rows — no stored collection, always reflects current receipts. */
async function computeDefaulters(schoolId: string): Promise<Array<ReturnType<typeof toDefaulter>>> {
  const session = await getActiveSessionName(schoolId);
  const startYear = parseInt(session.split('-')[0]!, 10) || new Date().getFullYear();
  const annual = await annualByClass(schoolId, session);
  const students = await StudentModel.find({ schoolId }).lean();
  const receipts = await ReceiptModel.find({ schoolId, status: 'active' }).lean();
  const byStudent = new Map<string, typeof receipts>();
  for (const r of receipts) {
    const sid = String(r.studentId ?? '');
    const list = byStudent.get(sid) ?? [];
    list.push(r);
    byStudent.set(sid, list);
  }
  const lastReminderByStudent = new Map<string, string>();
  for (const l of await ReminderLogModel.find({ schoolId }).sort({ sentAt: -1 }).lean()) {
    const sid = String(l.studentId ?? '');
    if (!lastReminderByStudent.has(sid)) lastReminderByStudent.set(sid, l.sentAt as string);
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const out: Array<ReturnType<typeof toDefaulter>> = [];

  for (const s of students) {
    const cls = s.className ?? '';
    const totalFee = annual[cls] ?? 0;
    if (totalFee <= 0) continue;
    const monthlyDue = totalFee / 12;
    const studentReceipts = byStudent.get(String(s._id)) ?? [];

    let oldestUnpaidIdx = -1;
    let unpaidTotal = 0;
    for (let i = 0; i < MONTHS.length; i++) {
      const monthName = MONTHS[i]!;
      const paidForMonth = studentReceipts
        .filter((r) => (r.monthsCovered ?? []).includes(monthName))
        .reduce((sum, r) => sum + (r.amount ?? 0), 0);
      if (paidForMonth < monthlyDue - 1) {
        if (oldestUnpaidIdx === -1) oldestUnpaidIdx = i;
        unpaidTotal += monthlyDue - paidForMonth;
      }
    }
    if (oldestUnpaidIdx === -1) continue;

    const dueDate = monthDueDate(oldestUnpaidIdx, startYear);
    if (dueDate.getTime() > now) continue; // not yet due
    const daysOverdue = Math.floor((now - dueDate.getTime()) / DAY);
    if (daysOverdue <= 0) continue;

    out.push(
      toDefaulter(s, Math.round(unpaidTotal), MONTHS[oldestUnpaidIdx]!.slice(0, 3), daysOverdue, lastReminderByStudent.get(String(s._id))),
    );
  }
  return out;
}

function toDefaulter(s: Doc, totalDue: number, oldestDueMonth: string, daysOverdue: number, lastReminderAt?: string) {
  return {
    studentId: String(s._id),
    studentName: s.name,
    className: s.className ?? '',
    section: s.section ?? '',
    photoUrl: s.photoUrl,
    fatherMobile: (s.parents as { fatherMobile?: string } | undefined)?.fatherMobile ?? s.mobile ?? '',
    totalDue,
    oldestDueMonth,
    daysOverdue,
    agingBucket: agingBucketFor(daysOverdue),
    lastReminderAt,
  };
}

function toPlan(d: Doc, studentsAssigned: number) {
  return {
    id: String(d._id),
    name: d.name,
    installmentsCount: d.installmentsCount,
    frequency: d.frequency,
    customDates: d.customDates ?? [],
    applicableFeeHeads: d.applicableFeeHeads ?? [],
    processingFee: d.processingFee ?? 0,
    latePaymentFinePerDay: d.latePaymentFinePerDay ?? 0,
    active: d.active ?? true,
    studentsAssigned,
  };
}
function toInstallment(d: Doc) {
  return {
    id: String(d._id),
    studentId: String(d.studentId),
    studentName: d.studentName,
    className: d.className,
    planId: d.planId,
    planName: d.planName,
    totalAmount: d.totalAmount ?? 0,
    paidAmount: d.paidAmount ?? 0,
    remainingAmount: d.remainingAmount ?? 0,
    nextDueDate: d.nextDueDate,
    nextInstallmentAmount: d.nextInstallmentAmount,
    status: d.status,
    schedule: d.schedule ?? [],
  };
}
function toRule(d: Doc) {
  return {
    id: String(d._id),
    name: d.name,
    trigger: d.trigger,
    channel: d.channel,
    templateId: d.templateId,
    audience: d.audience,
    audienceClassKeys: d.audienceClassKeys ?? [],
    audienceMinAmount: d.audienceMinAmount,
    active: d.active ?? true,
    lastRunAt: d.lastRunAt,
  };
}
function toLog(d: Doc) {
  return {
    id: String(d._id),
    ruleId: d.ruleId,
    ruleName: d.ruleName,
    sentAt: d.sentAt,
    studentName: d.studentName,
    className: d.className,
    amountDue: d.amountDue ?? 0,
    channel: d.channel,
    status: d.status,
    messagePreview: d.messagePreview,
  };
}
function toSiblingGroup(d: Doc) {
  return {
    id: String(d._id),
    parentName: d.parentName,
    parentMobile: d.parentMobile,
    children: d.children ?? [],
    discountApplied: d.discountApplied ?? false,
  };
}

export const feeRecoveryService = {
  async getDashboard(schoolId: string) {
    const defaulters = await computeDefaulters(schoolId);
    const classes = Array.from(new Set(defaulters.map((d) => `${d.className}-${d.section}`)));
    const outstandingByClass = classes.map((classKey) => {
      const rows = defaulters.filter((d) => `${d.className}-${d.section}` === classKey);
      return { classKey, outstanding: rows.reduce((s, r) => s + r.totalDue, 0), students: rows.length };
    });
    const agingBuckets = {
      '0_30': defaulters.filter((d) => d.agingBucket === '0_30').length,
      '30_60': defaulters.filter((d) => d.agingBucket === '30_60').length,
      '60_90': defaulters.filter((d) => d.agingBucket === '60_90').length,
      '90_plus': defaulters.filter((d) => d.agingBucket === '90_plus').length,
    };
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const receipts = await ReceiptModel.find({ schoolId, status: 'active' }).lean();
    const recoveredThisMonth = receipts
      .filter((r) => (r.paymentDate ?? '').slice(0, 7) === monthPrefix)
      .reduce((s, r) => s + (r.amount ?? 0), 0);
    const remindersThisMonth = await ReminderLogModel.countDocuments({
      schoolId,
      sentAt: { $regex: `^${monthPrefix}` },
    });

    return {
      totalOutstanding: defaulters.reduce((s, d) => s + d.totalDue, 0),
      defaultersCount: defaulters.length,
      remindersThisMonth,
      recoveredThisMonth,
      outstandingByClass,
      agingBuckets,
    };
  },

  // ── Installment plans ──
  async listPlans(schoolId: string) {
    const [plans, counts] = await Promise.all([
      InstallmentPlanModel.find({ schoolId }).sort({ createdAt: -1 }).lean(),
      StudentInstallmentModel.aggregate<{ _id: string; count: number }>([
        { $match: { schoolId: new Types.ObjectId(schoolId) } },
        { $group: { _id: '$planId', count: { $sum: 1 } } },
      ]),
    ]);
    const countMap = new Map(counts.map((c) => [c._id, c.count]));
    return plans.map((p) => toPlan(p, countMap.get(String(p._id)) ?? 0));
  },
  async createPlan(schoolId: string, payload: Record<string, unknown>) {
    const { id: _ignored, studentsAssigned: _sa, ...rest } = payload;
    const doc = await InstallmentPlanModel.create({ schoolId, ...rest });
    return toPlan(doc.toObject(), 0);
  },
  async updatePlan(schoolId: string, id: string, payload: Record<string, unknown>) {
    const { id: _ignored, studentsAssigned: _sa, ...rest } = payload;
    const doc = await InstallmentPlanModel.findOneAndUpdate({ _id: id, schoolId }, { $set: rest }, { new: true });
    if (!doc) throw ApiError.notFound('Installment plan not found');
    const count = await StudentInstallmentModel.countDocuments({ schoolId, planId: id });
    return toPlan(doc.toObject(), count);
  },

  // ── Student installments ──
  async listStudentInstallments(schoolId: string) {
    const docs = await StudentInstallmentModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toInstallment);
  },
  async assignInstallment(schoolId: string, payload: Record<string, unknown>) {
    const { id: _ignored, ...rest } = payload;
    const doc = await StudentInstallmentModel.create({ schoolId, ...rest });
    return toInstallment(doc.toObject());
  },
  async removeStudentInstallment(schoolId: string, id: string) {
    await StudentInstallmentModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  // ── Reminder rules ──
  async listRules(schoolId: string) {
    const docs = await ReminderRuleModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toRule);
  },
  async createRule(schoolId: string, payload: Record<string, unknown>) {
    const { id: _ignored, ...rest } = payload;
    const doc = await ReminderRuleModel.create({ schoolId, ...rest });
    return toRule(doc.toObject());
  },
  async toggleRule(schoolId: string, id: string, active: boolean) {
    const doc = await ReminderRuleModel.findOneAndUpdate({ _id: id, schoolId }, { $set: { active } }, { new: true });
    if (!doc) throw ApiError.notFound('Reminder rule not found');
    return toRule(doc.toObject());
  },
  async deleteRule(schoolId: string, id: string) {
    await ReminderRuleModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },
  async getReminderLog(schoolId: string) {
    const docs = await ReminderLogModel.find({ schoolId }).sort({ sentAt: -1 }).limit(200).lean();
    return docs.map(toLog);
  },

  // ── Sibling discount ──
  async listSiblingGroups(schoolId: string) {
    const docs = await SiblingGroupModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toSiblingGroup);
  },
  async scanSiblings(schoolId: string) {
    const students = await StudentModel.find({ schoolId }).lean();
    const byMobile = new Map<string, typeof students>();
    for (const s of students) {
      const mobile = (s.parents as { fatherMobile?: string } | undefined)?.fatherMobile ?? s.mobile;
      if (!mobile) continue;
      const list = byMobile.get(mobile) ?? [];
      list.push(s);
      byMobile.set(mobile, list);
    }
    let newGroups = 0;
    for (const [mobile, list] of byMobile.entries()) {
      if (list.length < 2) continue;
      const existing = await SiblingGroupModel.findOne({ schoolId, parentMobile: mobile });
      if (existing) continue;
      newGroups += 1;
      await SiblingGroupModel.create({
        schoolId,
        parentName: list[0]!.fatherName ?? '',
        parentMobile: mobile,
        children: list.map((s) => ({
          studentId: String(s._id),
          studentName: s.name,
          className: `${s.className}-${s.section}`,
          admissionNumber: s.admissionNumber,
        })),
        discountApplied: false,
      });
    }
    const found = await SiblingGroupModel.countDocuments({ schoolId });
    return { found, newGroups };
  },
  async applySiblingDiscount(schoolId: string, id: string) {
    const doc = await SiblingGroupModel.findOneAndUpdate({ _id: id, schoolId }, { $set: { discountApplied: true } }, { new: true });
    if (!doc) throw ApiError.notFound('Sibling group not found');
    return toSiblingGroup(doc.toObject());
  },
  async bulkApplySiblingDiscount(schoolId: string) {
    const res = await SiblingGroupModel.updateMany({ schoolId, discountApplied: false }, { $set: { discountApplied: true } });
    return { applied: res.modifiedCount };
  },

  // ── Defaulters ──
  async getDefaulters(schoolId: string, filter: { classKey?: string; minDaysOverdue?: number; minAmount?: number }) {
    let rows = await computeDefaulters(schoolId);
    if (filter.classKey && filter.classKey !== 'all') rows = rows.filter((d) => `${d.className}-${d.section}` === filter.classKey);
    if (typeof filter.minDaysOverdue === 'number') rows = rows.filter((d) => d.daysOverdue >= filter.minDaysOverdue!);
    if (typeof filter.minAmount === 'number') rows = rows.filter((d) => d.totalDue >= filter.minAmount!);
    return rows;
  },
  async sendReminder(schoolId: string, studentIds: string[], channel: MessagingChannel) {
    const defaulters = await computeDefaulters(schoolId);
    const byId = new Map(defaulters.map((d) => [d.studentId, d]));
    const students = await StudentModel.find({ _id: { $in: studentIds }, schoolId }).lean();
    const recipients = students.map((s) => ({
      id: String(s._id),
      name: s.name,
      mobile: (s.parents as { fatherMobile?: string } | undefined)?.fatherMobile ?? s.mobile ?? '',
    }));
    const results = await sendBulk(recipients, channel, 'Fee payment reminder');
    const now = new Date().toISOString();
    await ReminderLogModel.insertMany(
      results.map((r) => ({
        schoolId,
        ruleId: 'manual',
        ruleName: 'Manual reminder',
        studentId: r.recipientId,
        studentName: r.recipientName,
        className: byId.get(r.recipientId) ? `${byId.get(r.recipientId)!.className}-${byId.get(r.recipientId)!.section}` : '',
        amountDue: byId.get(r.recipientId)?.totalDue ?? 0,
        channel,
        status: r.status,
        messagePreview: `Dear Parent, fee payment is due for ${r.recipientName}. Please pay at the earliest.`,
        sentAt: now,
      })),
    );
    return {
      sent: results.filter((r) => r.status === 'delivered').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
  },

  /**
   * Auto-executes active reminder rules across every school. Handles the
   * `after_due` and `every_n_days_overdue` triggers, which map directly onto
   * the already-computed defaulter list. `before_due` / `on_due` need an
   * upcoming-installment lookahead (StudentInstallmentModel.schedule) and are
   * not implemented yet — those rules are skipped, not silently misfired.
   */
  async runReminderRules(): Promise<{ rulesRun: number; sent: number; failed: number }> {
    const rules = await ReminderRuleModel.find({ active: true }).lean();
    const bySchool = new Map<string, typeof rules>();
    for (const r of rules) {
      const key = String(r.schoolId);
      const list = bySchool.get(key) ?? [];
      list.push(r);
      bySchool.set(key, list);
    }

    let rulesRun = 0;
    let sent = 0;
    let failed = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const [schoolId, schoolRules] of bySchool.entries()) {
      const defaulters = await computeDefaulters(schoolId);
      for (const rule of schoolRules) {
        const kind = (rule.trigger as { kind: string; days?: number }).kind;
        const days = (rule.trigger as { kind: string; days?: number }).days ?? 0;
        if (kind !== 'after_due' && kind !== 'every_n_days_overdue') continue;

        let matches = defaulters.filter((d) =>
          kind === 'after_due' ? d.daysOverdue === days : days > 0 && d.daysOverdue % days === 0,
        );
        if (rule.audience === 'specific_classes' && (rule.audienceClassKeys ?? []).length > 0) {
          const keys = new Set(rule.audienceClassKeys as string[]);
          matches = matches.filter((d) => keys.has(`${d.className}-${d.section}`));
        } else if (rule.audience === 'above_threshold' && typeof rule.audienceMinAmount === 'number') {
          matches = matches.filter((d) => d.totalDue >= rule.audienceMinAmount!);
        }
        if (matches.length === 0) continue;

        // Skip students already reminded by this rule today.
        const alreadySent = await ReminderLogModel.find({
          schoolId,
          ruleId: String(rule._id),
          sentAt: { $regex: `^${today}` },
        })
          .select('studentId')
          .lean();
        const alreadySentIds = new Set(alreadySent.map((l) => String(l.studentId)));
        matches = matches.filter((d) => !alreadySentIds.has(d.studentId));
        if (matches.length === 0) continue;

        const students = await StudentModel.find({
          _id: { $in: matches.map((d) => d.studentId) },
          schoolId,
        }).lean();
        const recipients = students.map((s) => ({
          id: String(s._id),
          name: s.name,
          mobile: (s.parents as { fatherMobile?: string } | undefined)?.fatherMobile ?? s.mobile ?? '',
        }));
        const results = await sendBulk(recipients, rule.channel as MessagingChannel, 'Fee payment reminder');
        const byId = new Map(matches.map((d) => [d.studentId, d]));
        const now = new Date().toISOString();
        await ReminderLogModel.insertMany(
          results.map((r) => ({
            schoolId,
            ruleId: String(rule._id),
            ruleName: rule.name,
            studentId: r.recipientId,
            studentName: r.recipientName,
            className: byId.get(r.recipientId)
              ? `${byId.get(r.recipientId)!.className}-${byId.get(r.recipientId)!.section}`
              : '',
            amountDue: byId.get(r.recipientId)?.totalDue ?? 0,
            channel: rule.channel,
            status: r.status,
            messagePreview: `Dear Parent, fee payment is due for ${r.recipientName}. Please pay at the earliest.`,
            sentAt: now,
          })),
        );
        await ReminderRuleModel.updateOne({ _id: rule._id }, { $set: { lastRunAt: now } });
        rulesRun += 1;
        sent += results.filter((r) => r.status === 'delivered').length;
        failed += results.filter((r) => r.status === 'failed').length;
      }
    }
    return { rulesRun, sent, failed };
  },
};
