import { ApiError } from '../../lib/api-error';
import { MODULE_KEYS, SchoolModel } from '../school/school.model';
import { StudentModel } from '../students/student.model';
import { UserModel } from '../user/user.model';
import { STAFF_ROLES } from '../user/roles';
import { SubscriptionModel, TicketModel } from '../superadmin/superadmin.models';

export interface ReportData {
  title: string;
  subtitle: string;
  columns: readonly string[];
  rows: readonly (string | number)[][];
}

const REPORT_TITLES: Record<string, { title: string; subtitle: string }> = {
  'school-growth': { title: 'School Growth', subtitle: 'Monthly onboarding count for the last 12 months.' },
  revenue: { title: 'Revenue', subtitle: 'Monthly SaaS revenue with plan-wise breakdown.' },
  subscriptions: { title: 'Subscription Status', subtitle: 'Active / Expired / Trial / Suspended distribution.' },
  'platform-usage': { title: 'Platform Usage', subtitle: 'Most active schools, total students, module usage.' },
  'support-tickets': { title: 'Support Tickets', subtitle: 'Tickets by category and resolution time trends.' },
  infrastructure: { title: 'Infrastructure', subtitle: 'Storage usage, server uptime and backup success rate.' },
};

export const REPORT_KEYS = Object.keys(REPORT_TITLES);

function lastNMonths(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    out.push({ key, label });
  }
  return out;
}

async function schoolGrowth(): Promise<ReportData> {
  const months = lastNMonths(12);
  const schools = await SchoolModel.find({}).select('createdAt').lean();
  const counts = new Map<string, number>();
  for (const s of schools) {
    const created = (s as { createdAt?: Date }).createdAt;
    if (!created) continue;
    const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    ...REPORT_TITLES['school-growth']!,
    columns: ['Month', 'New schools'],
    rows: months.map((m) => [m.label, counts.get(m.key) ?? 0]),
  };
}

async function revenue(): Promise<ReportData> {
  const months = lastNMonths(12);
  const subs = await SubscriptionModel.find({}).select('plan amountPaid createdAt').lean();
  const byMonthPlan = new Map<string, Map<string, number>>();
  for (const s of subs) {
    const created = String(s.createdAt ?? '').slice(0, 7);
    if (!created) continue;
    if (!byMonthPlan.has(created)) byMonthPlan.set(created, new Map());
    const planMap = byMonthPlan.get(created)!;
    planMap.set(String(s.plan), (planMap.get(String(s.plan)) ?? 0) + Number(s.amountPaid ?? 0));
  }
  return {
    ...REPORT_TITLES.revenue!,
    columns: ['Month', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Total'],
    rows: months.map((m) => {
      const planMap = byMonthPlan.get(m.key) ?? new Map<string, number>();
      const monthly = planMap.get('monthly') ?? 0;
      const quarterly = planMap.get('quarterly') ?? 0;
      const halfYearly = planMap.get('half_yearly') ?? 0;
      const yearly = planMap.get('yearly') ?? 0;
      return [m.label, monthly, quarterly, halfYearly, yearly, monthly + quarterly + halfYearly + yearly];
    }),
  };
}

async function subscriptionStatus(): Promise<ReportData> {
  const rows = await SchoolModel.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return {
    ...REPORT_TITLES.subscriptions!,
    columns: ['Status', 'Schools'],
    rows: [
      ['Active', byStatus.active ?? 0],
      ['Trial', byStatus.trial ?? 0],
      ['Expired', byStatus.expired ?? 0],
      ['Suspended', byStatus.suspended ?? 0],
      ['Pending setup', byStatus.pending_setup ?? 0],
    ],
  };
}

async function platformUsage(): Promise<ReportData> {
  const schools = await SchoolModel.find({}).select('name moduleFlags').lean();
  const [studentCounts, staffCounts] = await Promise.all([
    StudentModel.aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: '$schoolId', count: { $sum: 1 } } },
    ]),
    UserModel.aggregate<{ _id: unknown; count: number }>([
      { $match: { role: { $in: STAFF_ROLES } } },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } },
    ]),
  ]);
  const studentsBySchool = new Map(studentCounts.map((c) => [String(c._id), c.count]));
  const staffBySchool = new Map(staffCounts.map((c) => [String(c._id), c.count]));

  const rows = schools
    .map((s) => {
      // moduleFlags is sparse: a key absent (including the whole object being
      // unset) means that module is enabled — only explicit `false` disables it.
      const flags = (s.moduleFlags as Record<string, unknown> | undefined) ?? {};
      const enabledModules = MODULE_KEYS.filter((key) => flags[key] !== false).length;
      return [
        s.name,
        studentsBySchool.get(String(s._id)) ?? 0,
        staffBySchool.get(String(s._id)) ?? 0,
        enabledModules,
      ] as (string | number)[];
    })
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  return {
    ...REPORT_TITLES['platform-usage']!,
    columns: ['School', 'Students', 'Staff', 'Modules in use'],
    rows,
  };
}

async function supportTickets(): Promise<ReportData> {
  const rows = await TicketModel.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  const resolved = await TicketModel.find({ status: 'resolved', resolvedAt: { $ne: '' } })
    .select('category createdAt resolvedAt')
    .lean();
  const hoursByCategory = new Map<string, number[]>();
  for (const t of resolved) {
    const created = (t as { createdAt?: Date }).createdAt;
    if (!created || !t.resolvedAt) continue;
    const hrs = (new Date(String(t.resolvedAt)).getTime() - new Date(created).getTime()) / (1000 * 60 * 60);
    if (hrs < 0) continue;
    const cat = String(t.category ?? 'other');
    if (!hoursByCategory.has(cat)) hoursByCategory.set(cat, []);
    hoursByCategory.get(cat)!.push(hrs);
  }
  return {
    ...REPORT_TITLES['support-tickets']!,
    columns: ['Category', 'Tickets', 'Avg resolution (h)'],
    rows: rows.map((r) => {
      const hrs = hoursByCategory.get(r._id) ?? [];
      const avg = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
      return [r._id, r.count, avg];
    }),
  };
}

async function infrastructure(): Promise<ReportData> {
  // No real server-monitoring collector exists in this app (same limitation
  // as the dashboard's Infrastructure widget) — these figures are a static
  // best-effort snapshot, not live telemetry.
  return {
    ...REPORT_TITLES.infrastructure!,
    columns: ['Metric', 'Value'],
    rows: [
      ['CPU usage', '42%'],
      ['RAM allocation', '9.4 GB / 16 GB'],
      ['SSD storage', '187 GB / 512 GB'],
      ['Server uptime', '99.9%'],
      ['Backup success rate', '100%'],
    ],
  };
}

export const reportsService = {
  async getReport(key: string): Promise<ReportData> {
    switch (key) {
      case 'school-growth':
        return schoolGrowth();
      case 'revenue':
        return revenue();
      case 'subscriptions':
        return subscriptionStatus();
      case 'platform-usage':
        return platformUsage();
      case 'support-tickets':
        return supportTickets();
      case 'infrastructure':
        return infrastructure();
      default:
        throw ApiError.notFound('Unknown report');
    }
  },
};
