import { ApiError } from '../../lib/api-error';
import { TicketModel } from '../superadmin/superadmin.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

function ticketView(d: Doc): Record<string, unknown> {
  return {
    id: String(d._id),
    ticketNumber: d.ticketNumber ?? '',
    title: d.title ?? d.subject ?? '',
    description: d.description ?? '',
    category: d.category ?? 'other',
    priority: d.priority ?? 'medium',
    status: d.status ?? 'open',
    reporterName: d.reporterName ?? '',
    reporterRole: d.reporterRole ?? '',
    schoolName: d.schoolName ?? '',
    assignedTo: d.assignedTo ?? 'Unassigned',
    createdAt: (d as { createdAt?: Date }).createdAt
      ? new Date((d as { createdAt?: Date }).createdAt as Date).toISOString()
      : '',
    updatedAt: (d as { updatedAt?: Date }).updatedAt
      ? new Date((d as { updatedAt?: Date }).updatedAt as Date).toISOString()
      : '',
    resolvedAt: d.resolvedAt || undefined,
    attachments: ((d.attachments as Record<string, unknown>[]) ?? []).map((a) => ({
      id: String(a._id),
      fileName: a.fileName,
      fileSize: a.sizeBytes ?? a.fileSize ?? 0,
    })),
    stepsToReproduce: d.stepsToReproduce || undefined,
  };
}

function commentView(ticketId: string, c: Record<string, unknown> & { _id: unknown }): Record<string, unknown> {
  return {
    id: String(c._id),
    ticketId,
    authorId: c.authorId ?? '',
    authorName: c.authorName ?? '',
    authorRole: c.authorRole ?? '',
    body: c.body ?? '',
    createdAt: c.createdAt ?? '',
    attachments: ((c.attachments as Record<string, unknown>[]) ?? []).map((a) => ({
      id: String(a._id),
      fileName: a.fileName,
      fileSize: a.fileSize ?? 0,
    })),
    internal: Boolean(c.internal),
  };
}

function activityView(ticketId: string, a: Record<string, unknown> & { _id: unknown }): Record<string, unknown> {
  return {
    id: String(a._id),
    ticketId,
    createdAt: a.createdAt ?? '',
    performedBy: a.performedBy ?? '',
    action: a.action ?? '',
  };
}

async function requireTicket(id: string) {
  const doc = await TicketModel.findById(id);
  if (!doc) throw ApiError.notFound('Ticket not found');
  return doc;
}

export const supportService = {
  async getKpi() {
    const rows = await TicketModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));

    const resolved = await TicketModel.find({ status: 'resolved', resolvedAt: { $ne: '' } })
      .select('createdAt resolvedAt')
      .lean();
    const hours = resolved
      .map((t) => {
        const created = (t as { createdAt?: Date }).createdAt;
        if (!created || !t.resolvedAt) return null;
        return (new Date(String(t.resolvedAt)).getTime() - new Date(created).getTime()) / (1000 * 60 * 60);
      })
      .filter((h): h is number => h !== null && h >= 0);
    const avgResolutionHours = hours.length
      ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length)
      : 0;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const resolvedThisMonth = resolved.filter(
      (t) => t.resolvedAt && new Date(String(t.resolvedAt)) >= monthStart,
    ).length;

    return {
      open: byStatus.open ?? 0,
      inProgress: byStatus.in_progress ?? 0,
      resolvedThisMonth,
      avgResolutionHours,
    };
  },

  async getTickets(filter: { status?: string; category?: string; priority?: string; search?: string }) {
    const query: Record<string, unknown> = {};
    if (filter.status && filter.status !== 'all') query.status = filter.status;
    if (filter.category && filter.category !== 'all') query.category = filter.category;
    if (filter.priority && filter.priority !== 'all') query.priority = filter.priority;
    if (filter.search?.trim()) {
      const rx = new RegExp(filter.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ ticketNumber: rx }, { title: rx }];
    }
    const docs = await TicketModel.find(query).sort({ createdAt: -1 }).lean();
    return docs.map((d) => ticketView(d as Doc));
  },

  async getTicket(id: string) {
    const doc = await TicketModel.findById(id).lean();
    if (!doc) return null;
    return ticketView(doc as Doc);
  },

  async createTicket(payload: {
    title: string;
    description: string;
    category: string;
    priority: string;
    reporterName: string;
    reporterRole: string;
    schoolName?: string;
    stepsToReproduce?: string;
  }) {
    const year = new Date().getFullYear();
    const count = await TicketModel.countDocuments({});
    const ticketNumber = `TKT-${year}-${(count + 1).toString().padStart(3, '0')}`;
    const now = nowIso();

    const doc = await TicketModel.create({
      ticketNumber,
      title: payload.title,
      subject: payload.title,
      description: payload.description,
      category: payload.category,
      priority: payload.priority,
      status: 'open',
      reporterName: payload.reporterName,
      reporterRole: payload.reporterRole,
      schoolName: payload.schoolName ?? '',
      assignedTo: 'Unassigned',
      stepsToReproduce: payload.stepsToReproduce ?? '',
      activity: [{ createdAt: now, performedBy: payload.reporterName, action: 'Ticket created' }],
    });
    return ticketView(doc.toObject() as Doc);
  },

  async changeStatus(id: string, status: string) {
    const doc = await requireTicket(id);
    const prevStatus = doc.get('status');
    doc.set('status', status);
    if (status === 'resolved') doc.set('resolvedAt', nowIso());
    (doc.get('activity') as unknown[]).push({
      createdAt: nowIso(),
      performedBy: 'Support',
      action: `Status: ${prevStatus} → ${status}`,
    });
    await doc.save();
    return ticketView(doc.toObject() as Doc);
  },

  async assignTicket(id: string, assignedTo: string) {
    const doc = await requireTicket(id);
    doc.set('assignedTo', assignedTo);
    (doc.get('activity') as unknown[]).push({
      createdAt: nowIso(),
      performedBy: 'Support',
      action: `Assigned to ${assignedTo}`,
    });
    await doc.save();
    return ticketView(doc.toObject() as Doc);
  },

  async getComments(ticketId: string) {
    const doc = await TicketModel.findById(ticketId).lean();
    if (!doc) throw ApiError.notFound('Ticket not found');
    return ((doc.comments as unknown as Record<string, unknown>[]) ?? []).map((c) =>
      commentView(ticketId, c as Record<string, unknown> & { _id: unknown }),
    );
  },

  async addComment(
    ticketId: string,
    payload: { body: string; internal: boolean; authorName: string; authorRole: string },
  ) {
    const doc = await requireTicket(ticketId);
    const now = nowIso();
    (doc.get('comments') as unknown[]).push({
      authorId: '',
      authorName: payload.authorName,
      authorRole: payload.authorRole,
      body: payload.body,
      createdAt: now,
      internal: payload.internal,
    });
    (doc.get('activity') as unknown[]).push({
      createdAt: now,
      performedBy: payload.authorName,
      action: payload.internal ? 'Added internal note' : 'Replied to ticket',
    });
    await doc.save();
    const comments = (doc.toObject() as Doc).comments as (Record<string, unknown> & { _id: unknown })[];
    return commentView(ticketId, comments[comments.length - 1]);
  },

  async getActivity(ticketId: string) {
    const doc = await TicketModel.findById(ticketId).lean();
    if (!doc) throw ApiError.notFound('Ticket not found');
    return ((doc.activity as unknown as Record<string, unknown>[]) ?? []).map((a) =>
      activityView(ticketId, a as Record<string, unknown> & { _id: unknown }),
    );
  },
};
