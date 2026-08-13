import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { NotificationModel } from '../communication/communication.models';
import { ExamMarkModel, ExamModel } from '../exams/exams.models';
import { ReceiptModel } from '../fee/fee.models';
import { feeService } from '../fee/fee.service';
import { ParentComplaintModel } from '../parent/parent.models';
import { StudentModel } from '../students/student.model';
import { TeacherClassModel } from '../teacher/teacher.models';
import { TeacherContentModel } from '../teacher-app/teacher-app.models';
import { OtpModel } from '../auth/otp.model';
import { UserModel } from '../user/user.model';
import { RouteModel, StudentTransportModel, VehicleModel } from '../transport/transport.models';
import { DriverLocationModel, DriverTripModel } from '../driver-app/driver-app.models';
import {
  ConversationModel,
  MessageModel,
  OutpassModel,
  ParentNotifReadModel,
  ParentRequestModel,
  RewardModel,
} from './parent-app.models';

type Doc = Record<string, unknown> & { _id: unknown };

/** Demo stop coordinates (Patiala) — mirrors driver-app until stops carry real lat/lng. */
const TRANSPORT_BASE = { lat: 30.3398, lng: 76.3869 };
function routeStopsFor(route: Doc, childStopName?: string) {
  return ((route.stops as Array<Record<string, unknown>>) ?? []).map((s, i) => ({
    id: `${String(route._id)}:stop:${i}`,
    name: (s.stopName as string) ?? `Stop ${i + 1}`,
    position: { lat: TRANSPORT_BASE.lat + i * 0.006, lng: TRANSPORT_BASE.lng + i * 0.006 },
    isChildStop: childStopName ? (s.stopName as string) === childStopName : undefined,
  }));
}
const nowIso = (): string => new Date().toISOString();
const ATT_OUT: Record<string, string> = { present: 'present', absent: 'absent', leave: 'leave', half_day: 'halfDay', late: 'late', holiday: 'holiday' };

async function parentMobile(userId: string): Promise<string> {
  const u = await UserModel.findById(userId).lean();
  const m = (u?.mobile as string) ?? '';
  if (!m) throw ApiError.forbidden('No linked mobile');
  return m;
}
/**
 * The subject records for this user. For a PARENT: their children (matched by
 * guardian mobile). For a STUDENT (the merged app — a student lands in the
 * parent UI): just their own roster record. So the same parent screens serve
 * both roles, scoped to the right subject.
 */
async function childrenOf(schoolId: string, userId: string): Promise<Doc[]> {
  const u = await UserModel.findById(userId).lean();
  const mobile = (u?.mobile as string) ?? '';
  if (!mobile) throw ApiError.forbidden('No linked mobile');
  if (u?.role === 'student') {
    const self = await StudentModel.findOne({ schoolId, mobile }).lean();
    return (self ? [self] : []) as unknown as Doc[];
  }
  return StudentModel.find({
    schoolId,
    $or: [{ 'parents.fatherMobile': mobile }, { 'parents.motherMobile': mobile }, { 'parents.guardianMobile': mobile }],
  }).lean() as unknown as Promise<Doc[]>;
}
async function ownChild(schoolId: string, userId: string, childId: string): Promise<Doc> {
  const kids = await childrenOf(schoolId, userId);
  const c = kids.find((k) => String(k._id) === childId);
  if (!c) throw ApiError.notFound('Child not found for this parent');
  return c;
}
const classKeyOf = (c: Doc): string => `${(c.className as string) ?? ''}-${(c.section as string) ?? ''}`;

export const parentAppService = {
  async children(schoolId: string, userId: string) {
    const kids = await childrenOf(schoolId, userId);
    return kids.map((k) => ({
      id: String(k._id),
      name: k.name as string,
      className: (k.className as string) ?? '',
      section: (k.section as string) ?? '',
      roll: (k.rollNumber as string) ?? '',
      avatarUrl: k.photoUrl as string | undefined,
    }));
  },

  async dashboardSummary(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const [notifs, reads, dues] = await Promise.all([
      NotificationModel.countDocuments({ schoolId }),
      ParentNotifReadModel.countDocuments({ schoolId, parentUserId: userId }),
      this.feeDues(schoolId, userId, childId),
    ]);
    return {
      childId,
      badges: {
        notifications: Math.max(notifs - reads, 0),
        fees: dues.totalOutstanding > 0 ? 1 : 0,
        outpass: await OutpassModel.countDocuments({ schoolId, childId, status: 'awaiting_parent' }),
        messenger: (await ConversationModel.find({ schoolId, parentUserId: userId }).lean()).reduce((s, c) => s + Number(c.unread ?? 0), 0),
      },
    };
  },

  async profile(schoolId: string, userId: string, childId: string) {
    const c = await ownChild(schoolId, userId, childId);
    const addr = (c.currentAddress as { line1?: string; city?: string; state?: string }) ?? {};
    const p = (c.parents as Record<string, string>) ?? {};
    return {
      id: childId,
      name: c.name as string,
      admissionNumber: (c.admissionNumber as string) ?? '',
      className: (c.className as string) ?? '',
      section: (c.section as string) ?? '',
      roll: (c.rollNumber as string) ?? '',
      photoUrl: c.photoUrl as string | undefined,
      identity: [
        { key: 'admissionNumber', value: (c.admissionNumber as string) ?? '' },
        { key: 'bloodGroup', value: (c.bloodGroup as string) ?? '' },
        { key: 'gender', value: (c.gender as string) ?? '' },
      ],
      guardian: [
        { key: 'fatherName', value: p.fatherName ?? '' },
        { key: 'fatherMobile', value: p.fatherMobile ?? '' },
        { key: 'motherName', value: p.motherName ?? '' },
      ],
      address: [addr.line1, addr.city, addr.state].filter(Boolean).join(', '),
      siblings: [],
      documents: [],
    };
  },

  async attendance(schoolId: string, userId: string, childId: string, month?: string) {
    await ownChild(schoolId, userId, childId);
    const all = await AttendanceModel.find({ schoolId, studentId: childId }).sort({ date: -1 }).lean();
    const targetMonth = month || (all[0]?.date as string)?.slice(0, 7) || nowIso().slice(0, 7);
    const inMonth = all.filter((r) => String(r.date).startsWith(targetMonth));
    const counts = { present: 0, absent: 0, leave: 0, halfDay: 0, late: 0 };
    for (const r of inMonth) {
      const k = ATT_OUT[String(r.status)];
      if (k && k in counts) (counts as Record<string, number>)[k] += 1;
    }
    const marked = inMonth.length;
    const present = counts.present + counts.halfDay * 0.5;
    return {
      summary: { percentage: marked ? Math.round((present / marked) * 100) : 0, counts },
      month: targetMonth,
      days: inMonth.map((r) => ({ date: r.date as string, status: ATT_OUT[String(r.status)] ?? 'notMarked' })),
    };
  },

  // ── Exams ──
  async examTimetable(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    // ponytail: no timetable model yet — return an empty week; build a Timetable model to populate.
    return { days: [], today: null };
  },
  async examSchedules(schoolId: string, userId: string, childId: string) {
    const c = await ownChild(schoolId, userId, childId);
    const exams = (await ExamModel.find({ schoolId }).lean()).filter((e) => (e.classes as string[])?.includes(c.className as string));
    return {
      exams: exams.map((e) => ({ id: String(e._id), name: e.name as string })),
      schedules: exams.map((e) => ({
        examId: String(e._id),
        examName: e.name as string,
        papers: ((e.dateSheet as Array<Record<string, unknown>>) ?? []).map((p, i) => ({
          id: `${String(e._id)}:${i}`,
          date: (p.date as string) ?? (e.startDate as string) ?? '',
          subject: (p.subject as string) ?? '',
          startTime: p.startTime as string | undefined,
          endTime: p.endTime as string | undefined,
          maxMarks: p.maxMarks as number | undefined,
        })),
      })),
    };
  },
  async examMarks(schoolId: string, userId: string, childId: string) {
    const c = await ownChild(schoolId, userId, childId);
    const key = classKeyOf(c);
    const exams = (await ExamModel.find({ schoolId }).lean()).filter((e) => (e.classes as string[])?.includes(c.className as string));
    const results = await Promise.all(
      exams.map(async (e) => {
        const published = ((e.publishedResults as string[]) ?? []).includes(key) || e.status === 'published';
        const marks = published ? await ExamMarkModel.find({ schoolId, examId: e._id, studentId: childId }).lean() : [];
        const subjects = marks.map((m) => {
          const obtained = Number(m.theory ?? 0) + Number(m.practical ?? 0) + Number(m.internal ?? 0);
          return { subject: String(m.subjectId), obtained, max: 100, status: obtained >= 33 ? ('pass' as const) : ('fail' as const) };
        });
        const total = subjects.reduce((s, x) => s + x.obtained, 0);
        const maxTotal = subjects.length * 100;
        const summary = subjects.length
          ? { total, maxTotal, percentage: maxTotal ? Math.round((total / maxTotal) * 100) : 0, grade: '', result: (total / (maxTotal || 1)) * 100 >= 33 ? ('pass' as const) : ('fail' as const) }
          : null;
        return { assessmentId: String(e._id), assessmentName: e.name as string, published, subjects, summary };
      }),
    );
    return { assessments: exams.map((e) => ({ id: String(e._id), name: e.name as string, published: e.status === 'published' })), results };
  },

  // ── Fees ──
  async childLedgerRow(schoolId: string, childId: string) {
    const rows = await feeService.ledger(schoolId, {});
    return rows.find((r) => r.studentId === childId) ?? null;
  },
  async feeDues(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const row = await this.childLedgerRow(schoolId, childId);
    const outstanding = row?.balance ?? 0;
    return {
      totalOutstanding: outstanding,
      items: outstanding > 0 ? [{ id: 'tuition', head: 'Tuition Fee', period: 'Session', amount: outstanding, concession: 0, fine: 0, netPayable: outstanding }] : [],
      previousDues: 0,
      advanceCredit: 0,
    };
  },
  async feeReceipts(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const receipts = await ReceiptModel.find({ schoolId, studentId: childId }).sort({ paymentDate: -1 }).lean();
    return receipts.map((r) => ({
      id: String(r._id),
      receiptNo: (r.receiptNumber as string) ?? '',
      date: (r.paymentDate as string) ?? '',
      amount: Number(r.amount ?? 0),
      paymentMethod: (r.paymentMode as string) ?? 'cash',
      status: r.status === 'cancelled' ? 'cancelled' : 'valid',
      items: ((r.feeHeads as Array<{ name?: string; amount?: number }>) ?? []).map((h) => ({ head: h.name ?? '', period: 'Session', amount: Number(h.amount ?? 0), concession: 0, fine: 0 })),
    }));
  },
  async feeLedger(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const receipts = await ReceiptModel.find({ schoolId, studentId: childId, status: 'active' }).sort({ paymentDate: 1 }).lean();
    let balance = (await this.childLedgerRow(schoolId, childId))?.totalFee ?? 0;
    const entries: unknown[] = [{ id: 'charge', date: '', description: 'Session fee charged', debit: balance, credit: 0, balance, status: 'pending' }];
    for (const r of receipts) {
      balance -= Number(r.amount ?? 0);
      entries.push({ id: String(r._id), date: (r.paymentDate as string) ?? '', description: `Receipt ${r.receiptNumber}`, credit: Number(r.amount ?? 0), debit: 0, balance: Math.max(balance, 0), status: 'paid' });
    }
    return entries;
  },

  // ── Notifications ──
  async notifications(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const [notifs, reads] = await Promise.all([
      NotificationModel.find({ schoolId }).sort({ createdAt: -1 }).lean(),
      ParentNotifReadModel.find({ schoolId, parentUserId: userId }).lean(),
    ]);
    const readSet = new Set(reads.map((r) => String(r.notificationId)));
    return notifs.map((n) => ({
      id: String(n._id),
      category: (n.category as string) ?? 'general',
      title: n.title as string,
      body: (n.description as string) ?? '',
      createdAt: (n.createdAt as string) ?? '',
      read: readSet.has(String(n._id)),
      targetKind: 'none',
    }));
  },
  async markNotifRead(schoolId: string, userId: string, id: string) {
    await ParentNotifReadModel.updateOne(
      { schoolId, parentUserId: userId, notificationId: id },
      { $set: { schoolId, parentUserId: userId, notificationId: id } },
      { upsert: true },
    );
  },
  async markAllNotifRead(schoolId: string, userId: string) {
    const notifs = await NotificationModel.find({ schoolId }).lean();
    await Promise.all(
      notifs.map((n) =>
        ParentNotifReadModel.updateOne(
          { schoolId, parentUserId: userId, notificationId: String(n._id) },
          { $set: { schoolId, parentUserId: userId, notificationId: String(n._id) } },
          { upsert: true },
        ),
      ),
    );
  },

  // ── Complaints ──
  async complaints(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const rows = await ParentComplaintModel.find({ schoolId, studentId: childId }).sort({ submittedAt: -1 }).lean();
    return rows.map((r) => ({
      id: String(r._id),
      category: (r.category as string) ?? 'other',
      subject: r.subject as string,
      description: (r.description as string) ?? '',
      submittedAt: (r.submittedAt as string) ?? '',
      status: (r.status as string) ?? 'submitted',
      resolution: r.resolution as string | undefined,
    }));
  },
  async submitComplaint(schoolId: string, userId: string, childId: string, values: Record<string, string>) {
    await ownChild(schoolId, userId, childId);
    const doc = await ParentComplaintModel.create({
      schoolId,
      studentId: childId,
      guardianUserId: userId,
      subject: values.subject ?? 'Complaint',
      category: values.category ?? 'other',
      description: values.description ?? '',
      submittedAt: nowIso(),
      status: 'submitted',
    });
    const r = doc.toObject();
    return { id: String(r._id), category: r.category, subject: r.subject, description: r.description, submittedAt: r.submittedAt, status: r.status };
  },

  // ── Requests ──
  requestView(d: Doc) {
    return {
      id: String(d._id),
      type: d.type,
      title: d.title,
      createdAt: d.createdAt,
      status: d.status,
      fields: (d.fields as unknown[]) ?? [],
      stages: (d.stages as unknown[]) ?? [],
      canCancel: d.canCancel !== false && (d.status === 'pending' || d.status === 'under_review'),
      attachments: (d.attachments as unknown[]) ?? [],
    };
  },
  async requests(schoolId: string, userId: string, childId: string, type?: string) {
    await ownChild(schoolId, userId, childId);
    const q: Record<string, unknown> = { schoolId, childId };
    if (type) q.type = type;
    return (await ParentRequestModel.find(q).sort({ createdAt: -1 }).lean()).map((d) => this.requestView(d as Doc));
  },
  async submitRequest(schoolId: string, userId: string, childId: string, type: string, values: Record<string, string>) {
    await ownChild(schoolId, userId, childId);
    const doc = await ParentRequestModel.create({
      schoolId,
      childId,
      parentUserId: userId,
      type,
      title: values.title || values.reason || `${type} request`,
      createdAt: nowIso(),
      status: 'pending',
      fields: Object.entries(values).map(([label, value]) => ({ label, value })),
      stages: [{ label: 'Class Teacher', state: 'current' }, { label: 'Principal', state: 'pending' }],
      canCancel: true,
    });
    return this.requestView(doc.toObject() as Doc);
  },
  async cancelRequest(schoolId: string, userId: string, childId: string, id: string) {
    await ownChild(schoolId, userId, childId);
    const doc = await ParentRequestModel.findOneAndUpdate({ _id: id, schoolId, childId }, { $set: { status: 'cancelled', canCancel: false } }, { new: true });
    if (!doc) throw ApiError.notFound('Request not found');
    return this.requestView(doc.toObject() as Doc);
  },

  // ── Outpass ──
  outpassView(d: Doc) {
    return { id: String(d._id), reason: d.reason, date: d.date, requestedBy: d.requestedBy, status: d.status, exitTime: d.exitTime, entryTime: d.entryTime };
  },
  async outpasses(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    return (await OutpassModel.find({ schoolId, childId }).sort({ createdAt: -1 }).lean()).map((d) => this.outpassView(d as Doc));
  },
  async outpassOtp(schoolId: string, userId: string, childId: string, id: string) {
    await ownChild(schoolId, userId, childId);
    const op = await OutpassModel.findOne({ _id: id, schoolId, childId });
    if (!op) throw ApiError.notFound('Outpass not found');
    const mobile = await parentMobile(userId);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await OtpModel.create({ channel: `outpass:${id}`, purpose: 'login', code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
    return { cooldownSeconds: 60, maskedContact: `•••••• ${mobile.slice(-4)}`, ...(process.env.NODE_ENV !== 'production' ? { otp: code } : {}) };
  },
  async outpassApprove(schoolId: string, userId: string, childId: string, id: string, otp: string) {
    await ownChild(schoolId, userId, childId);
    const rec = await OtpModel.findOne({ channel: `outpass:${id}`, purpose: 'login', consumed: false }).sort({ createdAt: -1 });
    if (!rec || rec.code !== otp) throw ApiError.unauthorized('Invalid OTP');
    rec.consumed = true;
    await rec.save();
    const op = await OutpassModel.findOneAndUpdate({ _id: id, schoolId, childId }, { $set: { status: 'approved' } }, { new: true });
    if (!op) throw ApiError.notFound('Outpass not found');
    return this.outpassView(op.toObject() as Doc);
  },
  async outpassDecline(schoolId: string, userId: string, childId: string, id: string) {
    await ownChild(schoolId, userId, childId);
    const op = await OutpassModel.findOneAndUpdate({ _id: id, schoolId, childId }, { $set: { status: 'declined' } }, { new: true });
    if (!op) throw ApiError.notFound('Outpass not found');
    return this.outpassView(op.toObject() as Doc);
  },

  // ── Messenger ──
  convView(d: Doc) {
    return { id: String(d._id), name: d.name, role: d.role, avatarUrl: d.avatarUrl, lastMessage: d.lastMessage, lastAt: d.lastAt, unread: d.unread ?? 0 };
  },
  async conversations(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    return (await ConversationModel.find({ schoolId, parentUserId: userId }).sort({ lastAt: -1 }).lean()).map((d) => this.convView(d as Doc));
  },
  async thread(schoolId: string, userId: string, conversationId: string) {
    const conv = await ConversationModel.findOne({ _id: conversationId, schoolId, parentUserId: userId }).lean();
    if (!conv) throw ApiError.notFound('Conversation not found');
    const messages = await MessageModel.find({ schoolId, conversationId }).sort({ at: 1 }).lean();
    return {
      conversation: this.convView(conv as Doc),
      messages: messages.map((m) => ({ id: String(m._id), body: m.body as string, at: m.at as string, own: Boolean(m.senderIsParent), senderName: m.senderName as string | undefined })),
    };
  },
  async sendMessage(schoolId: string, userId: string, conversationId: string, body: string) {
    const conv = await ConversationModel.findOne({ _id: conversationId, schoolId, parentUserId: userId });
    if (!conv) throw ApiError.notFound('Conversation not found');
    const at = nowIso();
    const doc = await MessageModel.create({ schoolId, conversationId, body, at, senderIsParent: true, senderName: 'You' });
    conv.set({ lastMessage: body, lastAt: at });
    await conv.save();
    // ponytail: persisted only — real-time inbound delivery needs a messaging/push provider.
    const m = doc.toObject();
    return { id: String(m._id), body: m.body, at: m.at, own: true, senderName: 'You' };
  },
  async markConvRead(schoolId: string, userId: string, conversationId: string) {
    await ConversationModel.updateOne({ _id: conversationId, schoolId, parentUserId: userId }, { $set: { unread: 0 } });
  },

  // ── Utility ──
  async bag(schoolId: string, userId: string, childId: string) {
    const c = await ownChild(schoolId, userId, childId);
    const items = await TeacherContentModel.find({ schoolId, classSectionId: classKeyOf(c), active: true }).sort({ date: -1 }).lean();
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => ({ day, items: [] as unknown[] }));
    // Fold recent content into the most recent day bucket (no per-weekday timetable link yet).
    if (items.length) days[0].items = items.slice(0, 8).map((i) => ({ id: String(i._id), label: i.title as string, subject: i.subject as string | undefined, note: i.body as string | undefined }));
    return { days };
  },
  async rewards(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const entries = await RewardModel.find({ schoolId, childId }).sort({ date: -1 }).lean();
    return {
      totalPoints: entries.reduce((s, e) => s + Number(e.points ?? 0), 0),
      stars: Math.min(5, Math.floor(entries.reduce((s, e) => s + Number(e.points ?? 0), 0) / 20)),
      entries: entries.map((e) => ({ id: String(e._id), title: e.title as string, points: Number(e.points ?? 0), reason: e.reason as string, date: e.date as string })),
    };
  },
  async classIncharge(schoolId: string, userId: string, childId: string) {
    const c = await ownChild(schoolId, userId, childId);
    const assign = await TeacherClassModel.findOne({ schoolId, className: c.className, section: c.section, isClassTeacher: true }).lean();
    if (!assign) return { name: 'Not assigned', role: 'Class Teacher' };
    const teacher = await UserModel.findById(assign.teacherUserId).lean();
    return {
      name: (teacher?.name as string) ?? 'Class Teacher',
      role: 'Class Teacher',
      subject: ((assign.subjects as string[]) ?? [])[0],
      contact: (teacher?.mobile as string) ?? undefined,
      email: (teacher?.email as string) ?? undefined,
    };
  },
  async onlineClasses(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    // ponytail: no online-class scheduling model — return empty; add an OnlineClass model to populate.
    return [];
  },

  // ── Transport ──
  async transportAssignment(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const link = await StudentTransportModel.findOne({ schoolId, studentId: childId }).lean();
    if (!link?.routeId) return null;
    const vehicle = (await VehicleModel.findOne({ schoolId }).lean()) as Doc | null;
    const route = (await RouteModel.findOne({ _id: link.routeId, schoolId }).lean()) as Doc | null;
    return {
      route: (link.routeName as string) || (route?.routeName as string) || 'Route',
      stopName: (link.stopName as string) || (link.pickupPoint as string) || '',
      vehicle: (vehicle?.registrationNumber as string) ?? '',
      // ponytail: driver name/contact aren't on the vehicle/route model yet — pull
      // from the route's assigned driver here once that link exists.
      driverName: (route?.driverName as string) ?? '',
      driverContact: (route?.driverContact as string) ?? '',
    };
  },
  async transportLive(schoolId: string, userId: string, childId: string) {
    await ownChild(schoolId, userId, childId);
    const idle = (stops: ReturnType<typeof routeStopsFor>) => ({
      tripStatus: 'no_trip' as const,
      position: null,
      etaMinutes: null,
      boarding: 'unknown' as const,
      updatedAt: Date.now(),
      stops,
    });

    const link = await StudentTransportModel.findOne({ schoolId, studentId: childId }).lean();
    const routeId = link?.routeId ? String(link.routeId) : null;
    if (!routeId) return idle([]);

    const route = await RouteModel.findOne({ _id: routeId, schoolId }).lean();
    const stops = route ? routeStopsFor(route as Doc, link?.stopName as string | undefined) : [];

    // The real producer→consumer join: an active driver trip on the child's route,
    // and the latest GPS position the driver emitted for it.
    const active = await DriverTripModel.findOne({ schoolId, routeId, status: 'active' }).lean();
    if (!active) return idle(stops);

    const loc = await DriverLocationModel.findOne({ schoolId, tripId: active.tripId }).lean();
    const mark = ((active.boarding as Array<{ studentId: string; mark: string }>) ?? []).find(
      (b) => b.studentId === childId,
    )?.mark;
    const boarding = mark === 'boarded' ? 'boarded' : mark === 'deboarded' ? 'dropped' : 'not_yet';

    return {
      tripStatus: 'active' as const,
      position: loc && loc.lat != null && loc.lng != null ? { lat: loc.lat, lng: loc.lng } : null,
      bearing: (loc?.bearing as number | undefined) ?? undefined,
      etaMinutes: loc ? 8 : null,
      boarding,
      updatedAt: (loc?.updatedAt as number) || Date.now(),
      stops,
    };
  },

  // ── Payments (STUB — needs a payment gateway) ──
  async paymentOrder(schoolId: string, userId: string, childId: string, amount: number) {
    await ownChild(schoolId, userId, childId);
    // ponytail: STUB — real orders come from Razorpay/Stripe create-order.
    return { orderId: `order_stub_${Date.now()}`, amount };
  },
  async paymentVerify(schoolId: string, userId: string, childId: string, orderId: string) {
    await ownChild(schoolId, userId, childId);
    // ponytail: STUB — real verify checks the gateway signature and records a receipt.
    void orderId;
    const receipts = await this.feeReceipts(schoolId, userId, childId);
    return { success: false, receipt: receipts[0] ?? null };
  },
};
