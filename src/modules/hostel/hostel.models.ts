import { Schema, model, type InferSchemaType } from 'mongoose';

const buildingSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['boys', 'girls', 'co_ed'], default: 'boys' },
    floors: { type: Number, default: 1 },
    wardenName: { type: String, default: '' },
    wardenMobile: { type: String, default: '' },
    address: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    facilities: { type: [String], default: [] },
  },
  { timestamps: true },
);
export type BuildingDoc = InferSchemaType<typeof buildingSchema>;
export const BuildingModel = model('HostelBuilding', buildingSchema);

const bedSchema = new Schema({
  bedNumber: { type: String, default: '' },
  status: { type: String, enum: ['occupied', 'empty', 'maintenance'], default: 'empty' },
  studentId: String,
  studentName: String,
  studentPhoto: String,
  studentClass: String,
  sinceDate: String,
});

const roomSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    buildingId: { type: Schema.Types.ObjectId, ref: 'HostelBuilding', required: true, index: true },
    buildingName: { type: String, default: '' },
    floorNumber: { type: Number, default: 0 },
    roomNumber: { type: String, default: '' },
    roomType: { type: String, default: 'double' },
    totalBeds: { type: Number, default: 1 },
    monthlyCharge: { type: Number, default: 0 },
    facilities: { type: [String], default: [] },
    beds: { type: [bedSchema], default: [] },
    status: { type: String, enum: ['available', 'partial', 'full', 'maintenance'], default: 'available' },
  },
  { timestamps: true },
);
export type RoomDoc = InferSchemaType<typeof roomSchema>;
export const RoomModel = model('HostelRoom', roomSchema);

const hostelStudentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: String, required: true },
    studentName: { type: String, default: '' },
    photoUrl: String,
    className: { type: String, default: '' },
    buildingId: String,
    buildingName: String,
    roomId: String,
    roomNumber: String,
    bedId: String,
    bedNumber: String,
    allocatedFrom: String,
    monthlyFee: { type: Number, default: 0 },
    messIncluded: { type: Boolean, default: false },
    messMonthlyCharge: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['paid', 'pending', 'overdue'], default: 'pending' },
    status: { type: String, enum: ['allocated', 'vacated'], default: 'allocated' },
    vacateDate: String,
    vacateReason: String,
  },
  { timestamps: true },
);
export type HostelStudentDoc = InferSchemaType<typeof hostelStudentSchema>;
export const HostelStudentModel = model('HostelStudent', hostelStudentSchema);

const visitorSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    visitorName: { type: String, required: true },
    relation: { type: String, default: 'other' },
    studentId: String,
    studentName: String,
    className: String,
    roomNumber: String,
    purpose: { type: String, default: '' },
    checkInTime: String,
    checkOutTime: String,
    idProofType: { type: String, default: 'aadhaar' },
    idProofNumber: { type: String, default: '' },
    photoUrl: String,
    addedBy: { type: String, default: 'System' },
  },
  { timestamps: true },
);
export type VisitorDoc = InferSchemaType<typeof visitorSchema>;
export const HostelVisitorModel = model('HostelVisitor', visitorSchema);
