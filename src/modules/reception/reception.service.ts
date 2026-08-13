import { ApiError } from '../../lib/api-error';
import { AdminGateVisitorModel, OutPassModel } from '../outpass/outpass.models';
import { AppointmentModel, CallLogModel } from './reception.models';

type Doc = Record<string, unknown> & { _id: unknown };
const today = (): string => new Date().toISOString().slice(0, 10);
const nowIso = (): string => new Date().toISOString();

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

export const receptionService = {
  async dashboard(schoolId: string) {
    const [appts, calls, visitors, outPasses] = await Promise.all([
      AppointmentModel.find({ schoolId }).lean(),
      CallLogModel.find({ schoolId }).lean(),
      AdminGateVisitorModel.find({ schoolId }).lean(),
      OutPassModel.find({ schoolId }).lean(),
    ]);
    const t = today();
    const month = t.slice(0, 7);
    const visitorsToday = visitors.filter((v) => (v.checkInTime ?? '').slice(0, 10) === t);
    const outPassesToday = outPasses.filter((o) => (o.issueTime ?? '').slice(0, 10) === t);
    return {
      visitorsToday: visitorsToday.length,
      currentlyInside: visitors.filter((v) => v.checkInTime && !v.checkOutTime).length,
      checkedOut: visitors.filter((v) => v.checkOutTime).length,
      outPassesIssuedToday: outPassesToday.length,
      outPassesReturned: outPassesToday.filter((o) => o.status === 'returned').length,
      outPassesPending: outPasses.filter((o) => o.status === 'issued').length,
      outPassesOverdue: outPasses.filter((o) => o.status === 'overdue').length,
      inquiriesToday: calls.filter((c) => (c.loggedAt ?? '').slice(0, 10) === t).length,
      inquiriesThisMonth: calls.filter((c) => (c.loggedAt ?? '').slice(0, 7) === month).length,
      appointmentsToday: appts.filter((a) => a.date === t).length,
      appointmentsUpcoming: appts.filter((a) => a.status === 'scheduled' && (a.date ?? '') >= t).length,
      appointmentsCompleted: appts.filter((a) => a.status === 'completed').length,
      appointmentsCancelled: appts.filter((a) => a.status === 'cancelled').length,
    };
  },

  // Appointments
  async getAppointments(schoolId: string, date?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (date) filter.date = date;
    return (await AppointmentModel.find(filter).sort({ date: -1, time: 1 }).lean()).map(dto);
  },
  async createAppointment(schoolId: string, payload: Record<string, unknown>) {
    const { id, ...fields } = payload;
    void id;
    const doc = await AppointmentModel.create({ schoolId, ...fields });
    return dto(doc.toObject());
  },
  async setAppointmentStatus(schoolId: string, id: string, status: string) {
    const doc = await AppointmentModel.findOneAndUpdate({ _id: id, schoolId }, { status }, { new: true });
    if (!doc) throw ApiError.notFound('Appointment not found');
    return dto(doc.toObject());
  },

  // Call logs
  async getCallLogs(schoolId: string) {
    return (await CallLogModel.find({ schoolId }).sort({ loggedAt: -1 }).lean()).map(dto);
  },
  async createCallLog(schoolId: string, payload: Record<string, unknown>) {
    const { id, ...fields } = payload;
    void id;
    const doc = await CallLogModel.create({ schoolId, ...fields, loggedAt: (payload.loggedAt as string) ?? nowIso() });
    return dto(doc.toObject());
  },
  async markFollowUpDone(schoolId: string, id: string) {
    const doc = await CallLogModel.findOneAndUpdate({ _id: id, schoolId }, { followUpDone: true }, { new: true });
    if (!doc) throw ApiError.notFound('Call log not found');
    return dto(doc.toObject());
  },
};
