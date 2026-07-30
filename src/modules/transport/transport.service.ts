import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import {
  DriverModel,
  RouteModel,
  StudentTransportModel,
  VehicleModel,
} from './transport.models';

type Doc = Record<string, unknown> & { _id: unknown };

/** Strip mongo internals, expose `_id` as `id`. */
function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}
function routeDto(d: Doc) {
  const base = dto(d);
  base.stops = ((d.stops as Doc[]) ?? []).map((s) => {
    const { _id, ...rest } = s as Record<string, unknown>;
    return { id: String(_id), ...rest };
  });
  return base;
}

const isId = (v: unknown): boolean => /^[0-9a-fA-F]{24}$/.test(String(v ?? ''));

async function nextBusPassNumber(schoolId: string): Promise<string> {
  const count = await StudentTransportModel.countDocuments({ schoolId });
  return `BP-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
}

export const transportService = {
  async kpi(schoolId: string) {
    const [totalVehicles, drivers, routes, assignments] = await Promise.all([
      VehicleModel.countDocuments({ schoolId }),
      DriverModel.countDocuments({ schoolId }),
      RouteModel.find({ schoolId }).lean(),
      StudentTransportModel.find({ schoolId }).lean(),
    ]);
    return {
      totalVehicles,
      studentsAvailing: assignments.length,
      activeRoutes: routes.filter((r) => r.status === 'active').length,
      drivers,
      pendingFee: assignments.filter((a) => a.paymentStatus !== 'paid').reduce((s, a) => s + (a.monthlyFee ?? 0), 0),
    };
  },

  // Vehicles
  async getVehicles(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.status && q.status !== 'all') filter.status = q.status;
    if (q.search?.trim()) filter.registrationNumber = new RegExp(q.search.trim(), 'i');
    const docs = await VehicleModel.find(filter).sort({ registrationNumber: 1 }).lean();
    return docs.map(dto);
  },
  async getVehicle(schoolId: string, id: string) {
    const d = await VehicleModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Vehicle not found');
    return dto(d);
  },
  async createVehicle(schoolId: string, payload: Record<string, unknown>) {
    const doc = await VehicleModel.create({ schoolId, ...payload });
    return dto(doc.toObject());
  },
  async updateVehicle(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await VehicleModel.findOneAndUpdate({ _id: id, schoolId }, { $set: payload }, { new: true });
    if (!doc) throw ApiError.notFound('Vehicle not found');
    return dto(doc.toObject());
  },
  async changeVehicleStatus(schoolId: string, id: string, status: string) {
    const doc = await VehicleModel.findOneAndUpdate({ _id: id, schoolId }, { status }, { new: true });
    if (!doc) throw ApiError.notFound('Vehicle not found');
    return dto(doc.toObject());
  },

  // Drivers
  async getDrivers(schoolId: string) {
    const docs = await DriverModel.find({ schoolId }).sort({ name: 1 }).lean();
    return docs.map(dto);
  },
  async createDriver(schoolId: string, payload: Record<string, unknown>) {
    const doc = await DriverModel.create({ schoolId, ...payload });
    return dto(doc.toObject());
  },
  async updateDriver(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await DriverModel.findOneAndUpdate({ _id: id, schoolId }, { $set: payload }, { new: true });
    if (!doc) throw ApiError.notFound('Driver not found');
    return dto(doc.toObject());
  },

  // Routes
  async getRoutes(schoolId: string) {
    const [docs, assignments] = await Promise.all([
      RouteModel.find({ schoolId }).sort({ routeName: 1 }).lean(),
      StudentTransportModel.find({ schoolId }, { routeId: 1 }).lean(),
    ]);
    const counts = new Map<string, number>();
    for (const a of assignments) {
      if (!a.routeId) continue;
      counts.set(a.routeId, (counts.get(a.routeId) ?? 0) + 1);
    }
    return docs.map((d) => {
      const out = routeDto(d);
      out.studentsCount = counts.get(String(d._id)) ?? 0;
      return out;
    });
  },
  async getRoute(schoolId: string, id: string) {
    const [d, count] = await Promise.all([
      RouteModel.findOne({ _id: id, schoolId }).lean(),
      StudentTransportModel.countDocuments({ schoolId, routeId: id }),
    ]);
    if (!d) throw ApiError.notFound('Route not found');
    const out = routeDto(d);
    out.studentsCount = count;
    return out;
  },
  async upsertRoute(schoolId: string, route: Record<string, unknown>) {
    const { id, ...fields } = route;
    if (isId(id)) {
      const existing = await RouteModel.findOne({ _id: id, schoolId });
      if (existing) {
        existing.set(fields);
        await existing.save();
        return routeDto(existing.toObject());
      }
    }
    const doc = await RouteModel.create({ schoolId, ...fields });
    return routeDto(doc.toObject());
  },
  async deleteRoute(schoolId: string, id: string) {
    await RouteModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  // Student assignments
  async getAssignments(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.classKey) filter.className = q.classKey;
    if (q.routeId) filter.routeId = q.routeId;
    const docs = await StudentTransportModel.find(filter).sort({ createdAt: -1 }).lean();
    let rows = docs.map(dto);
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter((r) => String(r.studentName).toLowerCase().includes(s));
    }
    return rows;
  },
  async upsertAssignment(schoolId: string, row: Record<string, unknown>) {
    const studentId = String(row.studentId ?? '');
    const student = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');

    const routeId = row.routeId ? String(row.routeId) : undefined;
    const route = routeId ? await RouteModel.findOne({ _id: routeId, schoolId }).lean() : null;
    if (routeId && !route) throw ApiError.notFound('Route not found');

    // Name/class/photo always come from the real student record, not the client —
    // keeps this table from drifting the way the Admissions fee-status field did.
    const fields = {
      studentId,
      studentName: student.name,
      photoUrl: student.photoUrl,
      className: student.className ?? '',
      routeId,
      routeName: route ? route.routeName : String(row.routeName ?? ''),
      stopName: String(row.stopName ?? ''),
      pickupPoint: String(row.pickupPoint ?? ''),
      dropPoint: String(row.dropPoint ?? ''),
      monthlyFee: route ? (route.monthlyFee ?? 0) : Number(row.monthlyFee ?? 0),
      effectiveFrom: String(row.effectiveFrom ?? new Date().toISOString().slice(0, 10)),
    };

    // A student rides one route at a time — reassigning updates their existing
    // row (keeps the same bus pass number) instead of creating a duplicate.
    const existing = await StudentTransportModel.findOne({ schoolId, studentId });
    if (existing) {
      existing.set(fields);
      await existing.save();
      return dto(existing.toObject());
    }
    const busPassNumber = await nextBusPassNumber(schoolId);
    const doc = await StudentTransportModel.create({ schoolId, ...fields, paymentStatus: 'pending', busPassNumber });
    return dto(doc.toObject());
  },
  async removeAssignment(schoolId: string, id: string) {
    await StudentTransportModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  // Student sub-resource (served under /students/:id/transport)
  async studentTransport(schoolId: string, studentId: string) {
    const a = await StudentTransportModel.findOne({ schoolId, studentId }).lean();
    if (!a) return null;
    const route = a.routeName ? await RouteModel.findOne({ schoolId, routeName: a.routeName }).lean() : null;
    let driverMobile = '';
    if (route?.assignedDriverId) {
      const d = await DriverModel.findById(route.assignedDriverId).lean();
      driverMobile = d?.mobile ?? '';
    }
    return {
      routeName: a.routeName ?? '',
      pickupPoint: a.pickupPoint ?? '',
      dropPoint: a.dropPoint ?? '',
      driverName: route?.assignedDriverName ?? '',
      driverMobile,
      vehicleNumber: route?.assignedVehicleNumber ?? '',
    };
  },
};
