import { Schema, model, type InferSchemaType } from 'mongoose';

export const SIM_PROVIDERS = ['jio', 'airtel', 'vi', 'bsnl', 'other'] as const;
export const GPS_DEVICE_STATUSES = ['active', 'inactive', 'not_installed'] as const;

const maintenanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    vehicleId: { type: String, required: true, index: true },
    date: { type: String, required: true },
    issueDescription: { type: String, default: '' },
    repairDone: { type: String, default: '' },
    cost: { type: Number, default: 0 },
    vendor: { type: String, default: '' },
    nextServiceDate: String,
    addedBy: { type: String, default: 'System' },
  },
  { timestamps: true },
);
export type MaintenanceDoc = InferSchemaType<typeof maintenanceSchema>;
export const MaintenanceModel = model('VehicleMaintenance', maintenanceSchema);

const gpsDeviceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    vehicleId: { type: String, required: true },
    vehicleNumber: { type: String, default: '' },
    vehicleType: { type: String, default: 'bus' },
    routeAssigned: String,
    imei: { type: String, default: '' },
    simNumber: { type: String, default: '' },
    simProvider: { type: String, enum: SIM_PROVIDERS, default: 'jio' },
    simExpiry: { type: String, default: '' },
    deviceModel: { type: String, default: '' },
    installationDate: { type: String, default: '' },
    installedBy: { type: String, default: '' },
    serverEndpoint: { type: String, default: '' },
    status: { type: String, enum: GPS_DEVICE_STATUSES, default: 'not_installed' },
    lastSignalAt: String,
    notes: String,
  },
  { timestamps: true },
);
gpsDeviceSchema.index({ schoolId: 1, vehicleId: 1 }, { unique: true });
export type GpsDeviceDoc = InferSchemaType<typeof gpsDeviceSchema>;
export const GpsDeviceModel = model('GpsDevice', gpsDeviceSchema);
