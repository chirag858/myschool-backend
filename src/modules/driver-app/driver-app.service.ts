import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { RouteModel, StudentTransportModel, VehicleModel } from '../transport/transport.models';
import { DriverTripModel } from './driver-app.models';
import { clearBus, park, submitPosition, type BusPosition } from './duty-registry';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);

/**
 * The logged-in driver's bus, with the route it runs. THE scoping primitive for
 * the driver app: everything a driver can see or do is derived from this, so a
 * driver can never read or touch another bus. Returns null when no bus carries
 * this driver's login (`Vehicle.driverUserId`).
 */
async function myBus(schoolId: string, userId: string) {
  const bus = (await VehicleModel.findOne({ schoolId, driverUserId: userId }).lean()) as Doc | null;
  if (!bus) return null;
  const route = (await RouteModel.findOne({ schoolId, assignedVehicleId: String(bus._id) }).lean()) as Doc | null;
  return { bus, route };
}

/** Server-owned trip id — the app never supplies one (it cannot forge another bus's). */
const tripIdFor = (busId: string, type: string): string => `${busId}:${today()}:${type}`;

/**
 * The driver app's entire backend: which bus am I on, start/end my trip, and the
 * on-demand location channel. Route-scoped endpoints (whole-school assignment,
 * manifests, boarding marks, stored GPS pings, parent alerts, trip history) were
 * removed with the app rebuild — they either ignored the logged-in driver,
 * invented data, or were never delivered to anyone.
 */
export const driverAppService = {
  /** The driver's bus, its route + stops, how many students ride it, and the
   *  trip that is running right now (if any). */
  async myBus(schoolId: string, userId: string) {
    const mine = await myBus(schoolId, userId);
    if (!mine) return { bus: null, route: null, studentCount: 0, activeTrip: null };
    const { bus, route } = mine;
    const routeId = route ? String(route._id) : null;
    const [studentCount, active] = await Promise.all([
      routeId ? StudentTransportModel.countDocuments({ schoolId, routeId }) : 0,
      DriverTripModel.findOne({ schoolId, busId: String(bus._id), status: 'active' }).lean(),
    ]);
    return {
      bus: {
        id: String(bus._id),
        registrationNumber: (bus.registrationNumber as string) ?? '',
        seatingCapacity: (bus.seatingCapacity as number) ?? 0,
      },
      route: route
        ? {
            id: routeId,
            name: (route.routeName as string) || (route.routeCode as string) || 'Route',
            stops: ((route.stops as Array<Record<string, unknown>>) ?? []).map((s, i) => ({
              order: (s.stopOrder as number) ?? i + 1,
              name: (s.stopName as string) ?? `Stop ${i + 1}`,
              pickupTime: (s.pickupTime as string) ?? '',
              dropTime: (s.dropTime as string) ?? '',
            })),
          }
        : null,
      studentCount,
      activeTrip: active
        ? { tripId: active.tripId as string, type: active.type as string, startedAt: (active.startedAt as string) ?? '' }
        : null,
    };
  },

  /**
   * The students who ride this bus — grouped by stop in the app.
   *
   * Read-only: the driver needs to know who they are collecting, where, and how
   * to reach a parent if a child is not at the stop. There is no boarding
   * register: tapping through a roster mid-route is not something a driver
   * should be doing.
   */
  async myBusStudents(schoolId: string, userId: string) {
    const mine = await myBus(schoolId, userId);
    if (!mine?.route) return [];
    const links = await StudentTransportModel.find({ schoolId, routeId: String(mine.route._id) }).lean();
    // Only real ObjectIds reach the query — a legacy row holding something else
    // must not turn this into a 500 (the same CastError trap as exam marks).
    const ids = links.map((l) => String(l.studentId)).filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
    const students = await StudentModel.find({ schoolId, _id: { $in: ids } }).lean();
    const byId = new Map(students.map((s) => [String(s._id), s as Record<string, unknown>]));

    return links
      .map((l) => {
        const s = byId.get(String(l.studentId));
        const parents = (s?.parents ?? {}) as Record<string, string>;
        const className = s ? `${(s.className as string) ?? ''} ${(s.section as string) ?? ''}`.trim() : (l.className as string) ?? '';
        return {
          id: String(l.studentId),
          name: (l.studentName as string) || ((s?.name as string) ?? ''),
          className,
          stopName: (l.stopName as string) || (l.pickupPoint as string) || '',
          pickupPoint: (l.pickupPoint as string) ?? '',
          dropPoint: (l.dropPoint as string) ?? '',
          parentContact: parents.fatherMobile || parents.motherMobile || ((s?.mobile as string) ?? ''),
        };
      })
      .sort((a, b) => a.stopName.localeCompare(b.stopName) || a.name.localeCompare(b.name));
  },

  /**
   * Begin a trip on the driver's OWN bus. One at a time; the id is server-made.
   *
   * The leg is stated by the driver, never inferred from the server clock: a bus
   * can run late and a school can hold an afternoon event, so a guess would
   * silently file the run under the wrong leg.
   */
  async startBusTrip(schoolId: string, userId: string, type: string) {
    const mine = await myBus(schoolId, userId);
    if (!mine) throw ApiError.forbidden('You are not assigned to a bus');
    if (!mine.route) throw ApiError.conflict('Your bus has no route assigned yet');
    if (type !== 'pickup' && type !== 'drop') throw ApiError.badRequest('Choose pickup or drop');
    const busId = String(mine.bus._id);
    const running = await DriverTripModel.findOne({ schoolId, busId, status: 'active' }).lean();
    if (running) throw ApiError.conflict('A trip is already running on this bus');
    const tripType = type;
    const tripId = tripIdFor(busId, tripType);
    await DriverTripModel.findOneAndUpdate(
      { schoolId, tripId },
      {
        $set: {
          schoolId,
          busId,
          routeId: String(mine.route._id),
          tripId,
          routeName: (mine.route.routeName as string) ?? '',
          type: tripType,
          status: 'active',
          date: today(),
          startedAt: nowIso(),
          endedAt: '',
        },
      },
      { upsert: true },
    );
    return { tripId, type: tripType, status: 'active', startedAt: nowIso() };
  },

  /** End whatever trip is running on the driver's own bus. */
  async endBusTrip(schoolId: string, userId: string) {
    const mine = await myBus(schoolId, userId);
    if (!mine) throw ApiError.forbidden('You are not assigned to a bus');
    const run = await DriverTripModel.findOneAndUpdate(
      { schoolId, busId: String(mine.bus._id), status: 'active' },
      { $set: { status: 'completed', endedAt: nowIso() } },
      { new: true },
    );
    if (!run) throw ApiError.notFound('No trip is running on this bus');
    // Off duty: release the parked request so parents immediately stop being
    // able to locate this bus.
    clearBus(String(mine.bus._id));
    return { tripId: run.tripId as string, status: 'completed' };
  },

  /**
   * The driver app's parked request. Returns as soon as a parent asks for a
   * position (`{ locate: true, reqId }`), or empty after the park window — the
   * app simply parks again. Idle: no GPS is read while this waits.
   */
  async dutyWait(schoolId: string, userId: string) {
    const mine = await myBus(schoolId, userId);
    if (!mine) throw ApiError.forbidden('You are not assigned to a bus');
    const busId = String(mine.bus._id);
    const running = await DriverTripModel.findOne({ schoolId, busId, status: 'active' }).lean();
    if (!running) throw ApiError.conflict('Start a trip before going on duty');
    return park(busId);
  },

  /** The driver's phone answering a locate. The position is passed to the waiting
   *  parent and never stored. */
  async dutyPosition(schoolId: string, userId: string, reqId: string, position: BusPosition) {
    const mine = await myBus(schoolId, userId);
    if (!mine) throw ApiError.forbidden('You are not assigned to a bus');
    if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
      throw ApiError.badRequest('A valid lat/lng is required');
    }
    // `false` = nobody is waiting any more (the parent's request already timed
    // out). Not an error — the app just carries on and re-parks.
    return { delivered: submitPosition(String(mine.bus._id), reqId, position) };
  },
};
