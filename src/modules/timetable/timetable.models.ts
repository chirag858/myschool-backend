import { Schema, model, type InferSchemaType } from 'mongoose';

export const DAY_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const PERIOD_TYPES = ['class', 'break', 'lunch', 'assembly'] as const;
export const SUBJECT_TYPES = ['core', 'elective', 'activity', 'language'] as const;
export const ROOM_TYPES = ['classroom', 'lab', 'library', 'hall', 'sports'] as const;
export const ROOM_STATUS = ['available', 'occupied', 'maintenance'] as const;
export const ROOM_FACILITIES = ['projector', 'ac', 'smart_board', 'computer'] as const;

// ── Period ────────────────────────────────────────────────────────
const periodSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    order: { type: Number, required: true },
    name: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    type: { type: String, enum: PERIOD_TYPES, default: 'class' },
    applicableDays: { type: Schema.Types.Mixed, default: 'all' }, // string 'all' or array of DayOfWeek
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);
export type PeriodDoc = InferSchemaType<typeof periodSchema>;
export const PeriodModel = model('TimetablePeriod', periodSchema);

// ── Subject ───────────────────────────────────────────────────────
const subjectSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    type: { type: String, enum: SUBJECT_TYPES, default: 'core' },
    applicableClasses: { type: Schema.Types.Mixed, default: 'all' }, // string 'all' or array of class ids
    maxWeeklyPeriods: { type: Number, default: 5 },
    color: { type: String, default: '#6366F1' }, // Default Indigo
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);
export type SubjectDoc = InferSchemaType<typeof subjectSchema>;
export const SubjectModel = model('TimetableSubject', subjectSchema);

// ── Room ──────────────────────────────────────────────────────────
const roomSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: ROOM_TYPES, default: 'classroom' },
    capacity: { type: Number, default: 40 },
    floor: { type: String, default: 'G' },
    facilities: { type: [String], enum: ROOM_FACILITIES, default: [] },
    status: { type: String, enum: ROOM_STATUS, default: 'available' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);
export type RoomDoc = InferSchemaType<typeof roomSchema>;
export const RoomModel = model('TimetableRoom', roomSchema);

// ── TimetableSlot (Embedded) ──────────────────────────────────────
const timetableSlotSchema = new Schema(
  {
    classId: { type: String, required: true },
    section: { type: String, required: true },
    day: { type: String, enum: DAY_OF_WEEK, required: true },
    periodId: { type: String, required: true },
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    subjectColor: { type: String, required: true },
    teacherId: { type: String, required: true },
    teacherName: { type: String, required: true },
    roomId: { type: String, required: true },
    roomName: { type: String, required: true },
  },
  { _id: true, timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } } // Mongoose generates _id for embedded by default, which maps to id in toJSON
);
export type TimetableSlotDoc = InferSchemaType<typeof timetableSlotSchema>;

// ── TimetableClass ────────────────────────────────────────────────
const timetableClassSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    classId: { type: String, required: true },
    section: { type: String, required: true },
    slots: { type: [timetableSlotSchema], default: [] },
    published: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);
timetableClassSchema.index({ schoolId: 1, classId: 1, section: 1 }, { unique: true });
export type TimetableClassDoc = InferSchemaType<typeof timetableClassSchema>;
export const TimetableClassModel = model('TimetableClass', timetableClassSchema);
