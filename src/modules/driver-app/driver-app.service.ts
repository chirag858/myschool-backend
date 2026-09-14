import { ApiError } from '../../lib/api-error';
import { RouteModel, StudentTransportModel, VehicleModel } from '../transport/transport.models';
import { DriverAlertModel, DriverLocationModel, DriverTripModel } from './driver-app.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);
// Deterministic demo coordinates (Patiala) since route stops carry no lat/lng yet.
const BASE = { lat: 30.3398, lng: 76.3869 };
const stopPos = (i: number) => ({ lat: BASE.lat + i * 0.006, lng: BASE.lng + i * 0.006 });

async function requireRoute(schoolId: string, routeId: string): Promise<Doc> {
  const r = await RouteModel.findOne({ _id: routeId, schoolId }).lean();
  if (!r) throw ApiError.notFound('Route not found');
  return r as Doc;
}

function routeStops(r: Doc) {
  return ((r.stops as Array<Record<string, unknown>>) ?? []).map((s, i) => ({
    id: `${String(r._id)}:stop:${i}`,
    name: (s.stopName as string) ?? `Stop ${i + 1}`,
    position: stopPos(i),
    order: (s.stopOrder as number) ?? i + 1,
    time: (s.pickupTime as string) ?? undefined,
  }));
}

export const driverAppService = {
  async assignment(schoolId: string) {
    const routes = await RouteModel.find({ schoolId }).lean();
    const vehicle = await VehicleModel.findOne({ schoolId }).lean();
    return {
      routes: routes.map((r) => ({
        id: String(r._id),
        name: (r.routeName as string) || (r.routeCode as string) || 'Route',
        stops: routeStops(r as Doc),
        vehicle: {
          registrationNumber: (vehicle?.registrationNumber as string) ?? 'PB-11-AB-1234',
          vehicleNumber: (vehicle?.registrationNumber as string) ?? 'PB-11-AB-1234',
          seatingCapacity: (vehicle?.seatingCapacity as number) ?? 40,
          model: vehicle?.vehicleType as string | undefined,
        },
        trips: [
          { id: `${String(r._id)}:pickup`, type: 'pickup', label: 'Morning Pickup', scheduledTime: '07:30', status: 'scheduled' },
          { id: `${String(r._id)}:drop`, type: 'drop', label: 'Afternoon Drop', scheduledTime: '14:30', status: 'scheduled' },
        ],
      })),
    };
  },

  async manifest(schoolId: string, routeId: string, tripId: string) {
    await requireRoute(schoolId, routeId);
    const students = await StudentTransportModel.find({ schoolId, routeId }).lean();
    const run = await DriverTripModel.findOne({ schoolId, routeId, tripId }).lean();
    const marks = new Map(((run?.boarding as Array<{ studentId: string; mark: string }>) ?? []).map((b) => [b.studentId, b.mark]));
    const type = tripId.endsWith('drop') ? 'drop' : 'pickup';
    return {
      routeId,
      tripId,
      tripType: type,
      students: students.map((s, i) => ({
        id: String(s.studentId),
        name: (s.studentName as string) ?? '',
        roll: String(i + 1),
        stopId: `${routeId}:stop:${i}`,
        stopName: (s.stopName as string) ?? '',
        parentContact: ((s as Record<string, unknown>).parentContact as string) ?? undefined,
        mark: marks.get(String(s.studentId)) ?? 'pending',
      })),
    };
  },

  async startTrip(schoolId: string, routeId: string, tripId: string) {
    const route = await requireRoute(schoolId, routeId);
    const type = tripId.endsWith('drop') ? 'drop' : 'pickup';
    await DriverTripModel.findOneAndUpdate(
      { schoolId, routeId, tripId },
      { $set: { schoolId, routeId, tripId, routeName: route.routeName ?? route.routeCode, type, status: 'active', date: today(), startedAt: nowIso() } },
      { upsert: true },
    );
    // Auto lifecycle alert (delivery to parents needs a messaging provider — see triggerAlert).
    await DriverAlertModel.create({ schoolId, routeId, tripId, type: 'started', at: nowIso(), auto: true, recipients: 'Route parents' });
    return { tripId, status: 'active' };
  },

  async endTrip(schoolId: string, tripId: string) {
    const run = await DriverTripModel.findOneAndUpdate(
      { schoolId, tripId },
      { $set: { status: 'completed', endedAt: nowIso() } },
      { new: true },
    );
    if (!run) throw ApiError.notFound('Trip not found');
    await DriverLocationModel.deleteOne({ schoolId, tripId });
    await DriverAlertModel.create({ schoolId, routeId: String(run.routeId), tripId, type: 'reached', at: nowIso(), auto: true, recipients: 'Route parents' });
    return { tripId, status: 'completed' };
  },

  async markBoarding(schoolId: string, tripId: string, studentId: string, mark: string) {
    const run = await DriverTripModel.findOne({ schoolId, tripId });
    if (!run) throw ApiError.notFound('Trip not found');
    if (run.status !== 'active') throw ApiError.conflict('Trip is not active');
    const boarding = (run.boarding as Array<{ studentId: string; mark: string; name?: string; roll?: string; stopName?: string }>) ?? [];
    const manifest = await this.manifest(schoolId, String(run.routeId), tripId);
    const student = manifest.students.find((s) => s.id === studentId);
    if (!student) throw ApiError.notFound('Student not on this manifest');
    const idx = boarding.findIndex((b) => b.studentId === studentId);
    const entry = { studentId, mark, name: student.name, roll: student.roll, stopName: student.stopName };
    if (idx === -1) boarding.push(entry);
    else boarding[idx] = entry;
    run.set('boarding', boarding);
    await run.save();
    return { ...student, mark };
  },

  async emit(schoolId: string, tripId: string, payload: { position: { lat: number; lng: number }; bearing?: number; tripType?: string; updatedAt?: number }) {
    const run = await DriverTripModel.findOne({ schoolId, tripId }).lean();
    await DriverLocationModel.findOneAndUpdate(
      { tripId },
      {
        $set: {
          schoolId,
          tripId,
          routeId: run ? String(run.routeId) : undefined,
          lat: payload.position?.lat,
          lng: payload.position?.lng,
          bearing: payload.bearing,
          tripType: payload.tripType ?? 'pickup',
          updatedAt: payload.updatedAt ?? Date.now(),
        },
      },
      { upsert: true },
    );
    return { ok: true };
  },

  async preview(schoolId: string, routeId: string) {
    const route = await requireRoute(schoolId, routeId);
    const stops = routeStops(route as Doc);
    const active = await DriverTripModel.findOne({ schoolId, routeId, status: 'active' }).lean();
    if (!active) return { tripStatus: 'no_trip', position: null, etaMinutes: null, boarding: 'unknown', updatedAt: Date.now(), stops };
    const loc = await DriverLocationModel.findOne({ schoolId, tripId: active.tripId }).lean();
    return {
      tripStatus: 'active',
      position: loc ? { lat: loc.lat, lng: loc.lng } : null,
      bearing: loc?.bearing,
      etaMinutes: loc ? 8 : null,
      boarding: 'unknown',
      updatedAt: (loc?.updatedAt as number) ?? Date.now(),
      stops,
    };
  },

  async alerts(schoolId: string) {
    return (await DriverAlertModel.find({ schoolId }).sort({ at: -1 }).lean()).map((a) => ({
      id: String(a._id),
      type: (a.type as string) ?? 'started',
      stopName: a.stopName as string | undefined,
      at: (a.at as string) ?? '',
      auto: Boolean(a.auto),
      recipients: a.recipients as string | undefined,
    }));
  },
  async triggerAlert(schoolId: string, tripId: string, type: string, stopId?: string) {
    const run = await DriverTripModel.findOne({ schoolId, tripId }).lean();
    const doc = await DriverAlertModel.create({
      schoolId,
      routeId: run ? String(run.routeId) : undefined,
      tripId,
      type,
      stopName: stopId,
      at: nowIso(),
      auto: false,
      recipients: 'Route parents',
    });
    const a = doc.toObject();
    return { id: String(a._id), type: a.type, stopName: a.stopName, at: a.at, auto: false, recipients: a.recipients };
  },

  tripHistoryView(run: Doc) {
    const boarding = (run.boarding as Array<{ mark: string }>) ?? [];
    return {
      id: String(run.tripId),
      date: (run.date as string) ?? '',
      routeName: (run.routeName as string) ?? '',
      type: run.type,
      startTime: (run.startedAt as string) ?? '',
      endTime: (run.endedAt as string) ?? '',
      boarded: boarding.filter((b) => b.mark === 'boarded' || b.mark === 'deboarded').length,
      total: boarding.length,
    };
  },
  async tripHistory(schoolId: string) {
    return (await DriverTripModel.find({ schoolId, status: 'completed' }).sort({ endedAt: -1 }).lean()).map((r) => this.tripHistoryView(r as Doc));
  },
  async tripDetail(schoolId: string, tripId: string) {
    const run = await DriverTripModel.findOne({ schoolId, tripId }).lean();
    if (!run) throw ApiError.notFound('Trip not found');
    const boarding = (run.boarding as Array<{ studentId: string; name: string; roll: string; mark: string; stopName: string }>) ?? [];
    return {
      ...this.tripHistoryView(run as Doc),
      outcomes: boarding.map((b) => ({ studentId: b.studentId, name: b.name, roll: b.roll, mark: b.mark, stopName: b.stopName })),
    };
  },
};
