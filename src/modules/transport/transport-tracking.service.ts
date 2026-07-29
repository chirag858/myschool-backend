import { ApiError } from '../../lib/api-error';
import { RouteModel, VehicleModel } from './transport.models';
import { GpsDeviceModel, MaintenanceModel } from './transport-tracking.models';

type Doc = Record<string, unknown> & { _id: unknown };

function toMaintenance(d: Doc) {
  return {
    id: String(d._id),
    date: d.date,
    issueDescription: d.issueDescription,
    repairDone: d.repairDone,
    cost: d.cost ?? 0,
    vendor: d.vendor,
    nextServiceDate: d.nextServiceDate,
    addedBy: d.addedBy,
  };
}
function toGpsDevice(d: Doc) {
  return {
    id: String(d._id),
    vehicleId: d.vehicleId,
    vehicleNumber: d.vehicleNumber,
    vehicleType: d.vehicleType,
    routeAssigned: d.routeAssigned,
    imei: d.imei,
    simNumber: d.simNumber,
    simProvider: d.simProvider,
    simExpiry: d.simExpiry,
    deviceModel: d.deviceModel,
    installationDate: d.installationDate,
    installedBy: d.installedBy,
    serverEndpoint: d.serverEndpoint,
    status: d.status,
    lastSignalAt: d.lastSignalAt,
    notes: d.notes,
  };
}

/** Minutes since local midnight for an "HH:MM" string. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function routeForVehicle(schoolId: string, vehicle: Doc) {
  return RouteModel.findOne({
    schoolId,
    $or: [{ assignedVehicleId: String(vehicle._id) }, { routeName: vehicle.routeName }],
  }).lean();
}

/** Compute today's live progress for a vehicle from its route's scheduled
 * departure windows — no GPS hardware or stored trip log required. */
function computeProgress(route: Doc | null): { status: 'live' | 'offline'; routeProgressPercent: number } {
  if (!route) return { status: 'offline', routeProgressPercent: 0 };
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const duration = Number(route.estimatedDurationMins) || 45;
  const slots = [route.morningDeparture, route.eveningDeparture].filter(Boolean) as string[];
  for (const slot of slots) {
    const start = minutesOf(slot);
    const elapsed = nowMins - start;
    if (elapsed >= 0 && elapsed <= duration) {
      return { status: 'live', routeProgressPercent: Math.min(100, Math.round((elapsed / duration) * 100)) };
    }
  }
  return { status: 'offline', routeProgressPercent: 0 };
}

export const transportTrackingService = {
  // ── Maintenance ──
  async getMaintenance(schoolId: string, vehicleId: string) {
    const docs = await MaintenanceModel.find({ schoolId, vehicleId }).sort({ date: -1 }).lean();
    return docs.map(toMaintenance);
  },
  async addMaintenance(schoolId: string, vehicleId: string, payload: Record<string, unknown>) {
    const doc = await MaintenanceModel.create({ schoolId, vehicleId, ...payload });
    return toMaintenance(doc.toObject());
  },

  // ── Trip history (derived from the vehicle's route schedule) ──
  async getTripHistory(schoolId: string, vehicleId: string) {
    const vehicle = await VehicleModel.findOne({ _id: vehicleId, schoolId }).lean();
    if (!vehicle) throw ApiError.notFound('Vehicle not found');
    const route = await routeForVehicle(schoolId, vehicle);
    if (!route) return [];

    const rows: Array<Record<string, unknown>> = [];
    const DAY = 24 * 60 * 60 * 1000;
    for (let i = 1; i <= 14; i++) {
      const date = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
      for (const [slotName, departure] of [
        ['Morning', route.morningDeparture],
        ['Evening', route.eveningDeparture],
      ] as const) {
        if (!departure) continue;
        const duration = Number(route.estimatedDurationMins) || 45;
        const startMins = minutesOf(departure);
        const endMins = startMins + duration;
        const endTime = `${String(Math.floor(endMins / 60) % 24).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
        rows.push({
          id: `${vehicleId}_${date}_${slotName}`,
          date,
          routeName: route.routeName,
          startTime: departure,
          endTime,
          driverName: vehicle.driverName ?? '—',
          studentsCount: vehicle.studentsAssigned ?? 0,
          remarks: `${slotName} trip`,
        });
      }
    }
    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  // ── Live tracking ──
  async getLivePositions(schoolId: string) {
    const vehicles = await VehicleModel.find({ schoolId, status: 'active' }).lean();
    const routes = await RouteModel.find({ schoolId }).lean();
    const routeByVehicleId = new Map(routes.filter((r) => r.assignedVehicleId).map((r) => [r.assignedVehicleId as string, r]));
    const routeByName = new Map(routes.map((r) => [r.routeName, r]));

    return vehicles
      .filter((v) => v.routeName)
      .map((v) => {
        const route = routeByVehicleId.get(String(v._id)) ?? routeByName.get(v.routeName ?? '') ?? null;
        const { status, routeProgressPercent } = computeProgress(route);
        return {
          vehicleId: String(v._id),
          vehicleNumber: v.registrationNumber,
          driverName: v.driverName ?? '—',
          routeName: v.routeName ?? '',
          studentsOnBoard: v.studentsAssigned ?? 0,
          lastUpdate: new Date().toISOString(),
          status,
          routeProgressPercent,
        };
      });
  },

  // ── GPS devices ──
  async getGpsDevices(schoolId: string) {
    const docs = await GpsDeviceModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toGpsDevice);
  },
  async saveGpsDevice(schoolId: string, payload: Record<string, unknown>) {
    const { id: _ignored, vehicleId, ...rest } = payload as { id?: string; vehicleId: string; [k: string]: unknown };
    const doc = await GpsDeviceModel.findOneAndUpdate(
      { schoolId, vehicleId },
      { $set: { schoolId, vehicleId, ...rest } },
      { new: true, upsert: true },
    );
    return toGpsDevice(doc.toObject());
  },
};
