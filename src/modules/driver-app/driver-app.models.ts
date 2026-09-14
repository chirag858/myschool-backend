import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** A running/completed trip with per-student boarding outcomes. */
const tripSchema = new Schema(
  {
    schoolId: school,
    routeId: { type: String, required: true, index: true },
    tripId: { type: String, required: true, index: true },
    routeName: { type: String, default: '' },
    type: { type: String, enum: ['pickup', 'drop'], default: 'pickup' },
    status: { type: String, enum: ['scheduled', 'active', 'completed'], default: 'scheduled' },
    date: { type: String, default: '' },
    startedAt: String,
    endedAt: String,
    boarding: { type: [Schema.Types.Mixed], default: [] }, // [{studentId,name,roll,mark,stopName}]
  },
  { timestamps: true },
);
tripSchema.index({ routeId: 1, tripId: 1 }, { unique: true });

/** The last emitted location for a trip (the GPS producer→consumer sink). */
const locationSchema = new Schema(
  {
    schoolId: school,
    routeId: { type: String, index: true },
    tripId: { type: String, required: true, unique: true },
    lat: Number,
    lng: Number,
    bearing: Number,
    tripType: { type: String, default: 'pickup' },
    updatedAt: { type: Number, default: 0 },
  },
  { timestamps: false },
);

/** A parent-facing transport alert (auto-dispatched by a driver event or manual). */
const alertSchema = new Schema(
  {
    schoolId: school,
    routeId: String,
    tripId: String,
    type: { type: String, default: 'started' },
    stopName: String,
    at: { type: String, default: '' },
    auto: { type: Boolean, default: false },
    recipients: String,
  },
  { timestamps: true },
);

export type TripDoc = InferSchemaType<typeof tripSchema>;
export const DriverTripModel = model('DriverTrip', tripSchema);
export const DriverLocationModel = model('DriverLocation', locationSchema);
export const DriverAlertModel = model('DriverAlert', alertSchema);
