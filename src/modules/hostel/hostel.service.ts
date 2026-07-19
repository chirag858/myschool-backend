import { ApiError } from '../../lib/api-error';
import { BuildingModel, HostelStudentModel, HostelVisitorModel, RoomModel } from './hostel.models';

type Doc = Record<string, unknown> & { _id: unknown };
const today = (): string => new Date().toISOString().slice(0, 10);

function bedsOf(room: Doc): Array<Record<string, unknown> & { _id: unknown }> {
  return (room.beds as Array<Record<string, unknown> & { _id: unknown }>) ?? [];
}
function occupiedCount(room: Doc): number {
  return bedsOf(room).filter((b) => b.status === 'occupied').length;
}
type RoomStatus = 'available' | 'partial' | 'full' | 'maintenance';
function roomStatus(room: Doc): RoomStatus {
  const beds = bedsOf(room);
  const total = Number(room.totalBeds) || beds.length;
  const occ = occupiedCount(room);
  if (beds.length && beds.every((b) => b.status === 'maintenance')) return 'maintenance';
  if (occ === 0) return 'available';
  if (occ >= total) return 'full';
  return 'partial';
}

function toBuilding(b: Doc, rooms: Doc[]) {
  const brooms = rooms.filter((r) => String(r.buildingId) === String(b._id));
  const statuses = brooms.map(roomStatus);
  return {
    id: String(b._id),
    name: b.name,
    type: b.type,
    floors: b.floors ?? 1,
    totalRooms: brooms.length,
    occupiedRooms: statuses.filter((s) => s === 'full').length,
    availableRooms: statuses.filter((s) => s === 'available' || s === 'partial').length,
    maintenanceRooms: statuses.filter((s) => s === 'maintenance').length,
    wardenName: b.wardenName ?? '',
    wardenMobile: b.wardenMobile ?? '',
    address: b.address ?? '',
    status: b.status ?? 'active',
    facilities: b.facilities ?? [],
  };
}
function toRoom(r: Doc) {
  return {
    id: String(r._id),
    buildingId: String(r.buildingId),
    buildingName: r.buildingName ?? '',
    floorNumber: r.floorNumber ?? 0,
    roomNumber: r.roomNumber ?? '',
    roomType: r.roomType ?? 'double',
    totalBeds: r.totalBeds ?? 0,
    occupiedBeds: occupiedCount(r),
    status: roomStatus(r),
    monthlyCharge: r.monthlyCharge ?? 0,
    facilities: r.facilities ?? [],
    beds: bedsOf(r).map((b) => ({
      id: String(b._id),
      bedNumber: b.bedNumber ?? '',
      status: b.status ?? 'empty',
      studentId: b.studentId,
      studentName: b.studentName,
      studentPhoto: b.studentPhoto,
      studentClass: b.studentClass,
      sinceDate: b.sinceDate,
    })),
  };
}
function toStudent(d: Doc) {
  return {
    id: String(d._id),
    studentId: d.studentId,
    studentName: d.studentName ?? '',
    photoUrl: d.photoUrl,
    className: d.className ?? '',
    buildingId: d.buildingId ?? '',
    buildingName: d.buildingName ?? '',
    roomId: d.roomId ?? '',
    roomNumber: d.roomNumber ?? '',
    bedId: d.bedId ?? '',
    bedNumber: d.bedNumber ?? '',
    allocatedFrom: d.allocatedFrom ?? '',
    monthlyFee: d.monthlyFee ?? 0,
    messIncluded: d.messIncluded ?? false,
    messMonthlyCharge: d.messMonthlyCharge ?? 0,
    paymentStatus: d.paymentStatus ?? 'pending',
    status: d.status ?? 'allocated',
  };
}
function toVisitor(d: Doc) {
  return {
    id: String(d._id),
    visitorName: d.visitorName,
    relation: d.relation ?? 'other',
    studentId: d.studentId ?? '',
    studentName: d.studentName ?? '',
    className: d.className ?? '',
    roomNumber: d.roomNumber ?? '',
    purpose: d.purpose ?? '',
    checkInTime: d.checkInTime ?? '',
    checkOutTime: d.checkOutTime,
    idProofType: d.idProofType ?? 'aadhaar',
    idProofNumber: d.idProofNumber ?? '',
    photoUrl: d.photoUrl,
    addedBy: d.addedBy ?? 'System',
  };
}

export const hostelService = {
  async kpi(schoolId: string) {
    const rooms = await RoomModel.find({ schoolId }).lean();
    const allocated = await HostelStudentModel.find({ schoolId, status: 'allocated' }).lean();
    const totalBeds = rooms.reduce((s, r) => s + (Number(r.totalBeds) || bedsOf(r).length), 0);
    const occupiedBeds = rooms.reduce((s, r) => s + occupiedCount(r), 0);
    const pendingFee = allocated
      .filter((s) => s.paymentStatus !== 'paid')
      .reduce((s, r) => s + (r.monthlyFee ?? 0), 0);
    return {
      totalRooms: rooms.length,
      occupiedBeds,
      availableBeds: Math.max(0, totalBeds - occupiedBeds),
      totalStudents: allocated.length,
      pendingFee,
    };
  },

  // Buildings
  async getBuildings(schoolId: string) {
    const [buildings, rooms] = await Promise.all([
      BuildingModel.find({ schoolId }).sort({ name: 1 }).lean(),
      RoomModel.find({ schoolId }).lean(),
    ]);
    return buildings.map((b) => toBuilding(b, rooms));
  },
  async upsertBuilding(schoolId: string, b: Record<string, unknown>) {
    const fields = {
      name: b.name,
      type: b.type,
      floors: b.floors,
      wardenName: b.wardenName,
      wardenMobile: b.wardenMobile,
      address: b.address,
      status: b.status,
      facilities: b.facilities,
    };
    const id = String(b.id ?? '');
    let doc;
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      doc = await BuildingModel.findOneAndUpdate({ _id: id, schoolId }, { $set: fields }, { new: true });
    }
    if (!doc) doc = await BuildingModel.create({ schoolId, ...fields });
    const rooms = await RoomModel.find({ schoolId, buildingId: doc._id }).lean();
    return toBuilding(doc.toObject(), rooms);
  },

  // Rooms
  async getRooms(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.buildingId) filter.buildingId = q.buildingId;
    if (q.floor) filter.floorNumber = Number(q.floor);
    const docs = await RoomModel.find(filter).sort({ roomNumber: 1 }).lean();
    let rooms = docs.map(toRoom);
    if (q.status && q.status !== 'all') rooms = rooms.filter((r) => r.status === q.status);
    return rooms;
  },
  async getRoom(schoolId: string, id: string) {
    const d = await RoomModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Room not found');
    return toRoom(d);
  },
  async upsertRoom(schoolId: string, r: Record<string, unknown>) {
    const building = await BuildingModel.findOne({ _id: r.buildingId, schoolId }).lean();
    if (!building) throw ApiError.notFound('Building not found');
    const fields = {
      buildingId: r.buildingId,
      buildingName: building.name,
      floorNumber: r.floorNumber,
      roomNumber: r.roomNumber,
      roomType: r.roomType,
      monthlyCharge: r.monthlyCharge,
      facilities: r.facilities,
    };
    const id = String(r.id ?? '');
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      const existing = await RoomModel.findOne({ _id: id, schoolId });
      if (existing) {
        Object.assign(existing, fields);
        await existing.save();
        return toRoom(existing.toObject());
      }
    }
    const total = Number(r.totalBeds) || 1;
    const beds = Array.from({ length: total }, (_, i) => ({ bedNumber: String(i + 1), status: 'empty' }));
    const doc = await RoomModel.create({ schoolId, ...fields, totalBeds: total, beds });
    return toRoom(doc.toObject());
  },

  // Students / allocation
  async getStudents(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.buildingId) filter.buildingId = q.buildingId;
    if (q.classKey) filter.className = q.classKey;
    if (q.status && q.status !== 'all') filter.status = q.status;
    const docs = await HostelStudentModel.find(filter).sort({ createdAt: -1 }).lean();
    let rows = docs.map(toStudent);
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter((r) => String(r.studentName).toLowerCase().includes(s));
    }
    return rows;
  },

  async allocate(schoolId: string, row: Record<string, unknown>) {
    const room = await RoomModel.findOne({ _id: row.roomId, schoolId });
    if (!room) throw ApiError.notFound('Room not found');
    const bed = (room.beds as unknown as { id: (id: string) => Record<string, unknown> | null }).id(String(row.bedId));
    if (!bed) throw ApiError.notFound('Bed not found');
    if (bed.status === 'occupied') throw ApiError.conflict('Bed is already occupied');

    const doc = await HostelStudentModel.create({
      schoolId,
      ...row,
      buildingId: String(room.buildingId),
      buildingName: room.buildingName,
      roomNumber: room.roomNumber,
      bedNumber: bed.bedNumber,
      allocatedFrom: row.allocatedFrom ?? today(),
      status: 'allocated',
    });
    bed.status = 'occupied';
    bed.studentId = String(row.studentId);
    bed.studentName = row.studentName as string;
    bed.studentClass = row.className as string;
    bed.sinceDate = today();
    room.status = roomStatus(room.toObject());
    await room.save();
    return toStudent(doc.toObject());
  },

  async vacate(schoolId: string, id: string, payload: { vacateDate: string; reason?: string }) {
    const record = await HostelStudentModel.findOne({ _id: id, schoolId });
    if (!record) throw ApiError.notFound('Allocation not found');
    record.status = 'vacated';
    record.vacateDate = payload.vacateDate;
    record.vacateReason = payload.reason;
    await record.save();

    const room = await RoomModel.findOne({ _id: record.roomId, schoolId });
    if (room) {
      const bed = (room.beds as unknown as { id: (id: string) => Record<string, unknown> | null }).id(String(record.bedId));
      if (bed) {
        bed.status = 'empty';
        bed.studentId = undefined;
        bed.studentName = undefined;
        bed.studentClass = undefined;
        bed.sinceDate = undefined;
      }
      room.status = roomStatus(room.toObject());
      await room.save();
    }
    return { success: true };
  },

  // Fee
  async feeRows(schoolId: string) {
    const allocated = await HostelStudentModel.find({ schoolId, status: 'allocated' }).lean();
    return allocated.map((s) => ({
      id: String(s._id),
      studentId: s.studentId,
      studentName: s.studentName ?? '',
      className: s.className ?? '',
      roomNumber: s.roomNumber ?? '',
      monthlyFee: s.monthlyFee ?? 0,
      amountDue: s.paymentStatus === 'paid' ? 0 : (s.monthlyFee ?? 0),
      dueDate: '2025-05-10',
      status: s.paymentStatus ?? 'pending',
    }));
  },

  // Visitors
  async getVisitors(schoolId: string) {
    const docs = await HostelVisitorModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toVisitor);
  },
  async addVisitor(schoolId: string, v: Record<string, unknown>, addedBy: string) {
    const doc = await HostelVisitorModel.create({
      schoolId,
      ...v,
      checkInTime: v.checkInTime ?? new Date().toISOString(),
      addedBy,
    });
    return toVisitor(doc.toObject());
  },
  async checkoutVisitor(schoolId: string, id: string) {
    const doc = await HostelVisitorModel.findOneAndUpdate(
      { _id: id, schoolId },
      { checkOutTime: new Date().toISOString() },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Visitor not found');
    return toVisitor(doc.toObject());
  },

  // Student sub-resource (served under /students/:id/hostel)
  async studentHostel(schoolId: string, studentId: string) {
    const rec = await HostelStudentModel.findOne({ schoolId, studentId, status: 'allocated' }).lean();
    if (!rec) return null;
    return {
      building: rec.buildingName ?? '',
      roomNumber: rec.roomNumber ?? '',
      bedNumber: rec.bedNumber ?? '',
      monthlyFee: rec.monthlyFee ?? 0,
    };
  },
};
