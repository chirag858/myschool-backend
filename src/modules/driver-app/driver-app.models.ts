import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/**
 * A bus trip — the driver's duty record for a run.
 *
 * This is the ONLY thing the driver app persists. There is deliberately no
 * location model beside it: a bus position is asked for, delivered to the parent
 * who asked, and forgotten (see `duty-registry.ts`), so no coordinate is ever
 * written to the database.
 */
const tripSchema = new Schema(
  {
    schoolId: school,
    /** The bus this trip runs on — the scoping key ("one trip at a time per bus"). */
    busId: { type: String, index: true },
    routeId: { type: String, required: true, index: true },
    tripId: { type: String, required: true, index: true },
    routeName: { type: String, default: '' },
    type: { type: String, enum: ['pickup', 'drop'], default: 'pickup' },
    status: { type: String, enum: ['scheduled', 'active', 'completed'], default: 'scheduled' },
    date: { type: String, default: '' },
    startedAt: String,
    endedAt: String,
  },
  { timestamps: true },
);
tripSchema.index({ routeId: 1, tripId: 1 }, { unique: true });

export type TripDoc = InferSchemaType<typeof tripSchema>;
export const DriverTripModel = model('DriverTrip', tripSchema);
