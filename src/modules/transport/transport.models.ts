import { Schema, model, type InferSchemaType } from 'mongoose';

const vehicleSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    registrationNumber: { type: String, required: true },
    vehicleType: { type: String, default: 'bus' },
    makeModel: { type: String, default: '' },
    manufacturingYear: { type: Number, default: 2015 },
    seatingCapacity: { type: Number, default: 0 },
    fuelType: { type: String, default: 'diesel' },
    gpsDeviceId: String,
    insurancePolicyNumber: { type: String, default: '' },
    insuranceExpiry: { type: String, default: '' },
    fitnessCertificateNumber: { type: String, default: '' },
    fitnessExpiry: { type: String, default: '' },
    permitNumber: { type: String, default: '' },
    permitExpiry: { type: String, default: '' },
    photoUrl: String,
    status: { type: String, default: 'active' },
    driverName: String,
    driverMobile: String,
    routeName: String,
    studentsAssigned: { type: Number, default: 0 },
    notes: String,
  },
  { timestamps: true },
);
export type VehicleDoc = InferSchemaType<typeof vehicleSchema>;
export const VehicleModel = model('Vehicle', vehicleSchema);

const driverSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    photoUrl: String,
    mobile: { type: String, default: '' },
    dateOfBirth: { type: String, default: '' },
    address: { type: String, default: '' },
    licenseNumber: { type: String, default: '' },
    licenseType: { type: String, default: 'hmv' },
    licenseExpiry: { type: String, default: '' },
    aadhaarNumber: { type: String, default: '' },
    experienceYears: { type: Number, default: 0 },
    joiningDate: { type: String, default: '' },
    salary: { type: Number, default: 0 },
    assignedVehicleId: String,
    assignedVehicleNumber: String,
    assignedRouteName: String,
    emergencyContactName: { type: String, default: '' },
    emergencyContactMobile: { type: String, default: '' },
    status: { type: String, default: 'active' },
  },
  { timestamps: true },
);
export type DriverDoc = InferSchemaType<typeof driverSchema>;
export const DriverModel = model('Driver', driverSchema);

const stopSchema = new Schema({
  stopOrder: { type: Number, default: 0 },
  stopName: { type: String, default: '' },
  landmark: String,
  pickupTime: { type: String, default: '' },
  dropTime: { type: String, default: '' },
  studentsCount: { type: Number, default: 0 },
});

const routeSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    routeName: { type: String, required: true },
    routeCode: { type: String, default: '' },
    fromLocation: { type: String, default: '' },
    toLocation: { type: String, default: '' },
    totalDistance: { type: Number, default: 0 },
    estimatedDurationMins: { type: Number, default: 0 },
    assignedVehicleId: String,
    assignedVehicleNumber: String,
    assignedDriverId: String,
    assignedDriverName: String,
    morningDeparture: { type: String, default: '' },
    eveningDeparture: { type: String, default: '' },
    stops: { type: [stopSchema], default: [] },
    studentsCount: { type: Number, default: 0 },
    monthlyFee: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);
export type RouteDoc = InferSchemaType<typeof routeSchema>;
export const RouteModel = model('TransportRoute', routeSchema);

const assignmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: String, required: true },
    studentName: { type: String, default: '' },
    photoUrl: String,
    className: { type: String, default: '' },
    routeId: String,
    routeName: { type: String, default: '' },
    stopName: { type: String, default: '' },
    pickupPoint: { type: String, default: '' },
    dropPoint: { type: String, default: '' },
    monthlyFee: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['paid', 'pending', 'overdue'], default: 'pending' },
    busPassNumber: { type: String, default: '' },
    effectiveFrom: { type: String, default: '' },
  },
  { timestamps: true },
);
export type AssignmentDoc = InferSchemaType<typeof assignmentSchema>;
export const StudentTransportModel = model('StudentTransport', assignmentSchema);
