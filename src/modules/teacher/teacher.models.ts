import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** Which classes/subjects a teacher is assigned to teach. */
const assignmentSchema = new Schema(
  {
    schoolId: school,
    teacherUserId: { type: String, required: true, index: true },
    classId: String,
    className: { type: String, default: '' },
    section: { type: String, default: '' },
    subjects: { type: [String], default: [] },
    periodsPerWeek: { type: Number, default: 6 },
  },
  { timestamps: true },
);

/** Homework/classwork posted by a teacher. */
const homeworkSchema = new Schema(
  {
    schoolId: school,
    teacherUserId: { type: String, default: '' },
    classKey: { type: String, required: true },
    section: String,
    subject: { type: String, default: '' },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    descriptionHtml: String,
    assignedDate: { type: String, default: '' },
    dueDate: { type: String, default: '' },
    dueTime: String,
    submissions: { type: Number, default: 0 },
    homeworkType: { type: String, enum: ['daily', 'holiday'], default: 'daily' },
    priority: { type: String, default: 'normal' },
    maxMarks: Number,
    estimatedMinutes: Number,
    allowLateSubmission: Boolean,
    notifyParents: Boolean,
    attachments: { type: [String], default: [] },
    createdBy: { type: String, default: '' },
    createdById: String,
    lastEditedBy: String,
    lastEditedAt: String,
    editHistory: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

/** A graded assignment posted by a teacher. */
const teacherAssignmentSchema = new Schema(
  {
    schoolId: school,
    teacherUserId: { type: String, default: '' },
    title: { type: String, required: true },
    classKey: { type: String, required: true },
    subject: { type: String, default: '' },
    description: { type: String, default: '' },
    instructions: { type: String, default: '' },
    maxMarks: { type: Number, default: 10 },
    assignedDate: { type: String, default: '' },
    dueDate: { type: String, default: '' },
    submissionType: { type: String, enum: ['document', 'text', 'both'], default: 'both' },
    status: { type: String, enum: ['draft', 'active', 'closed', 'overdue'], default: 'active' },
  },
  { timestamps: true },
);

/** One student's submission against an assignment. */
const submissionSchema = new Schema(
  {
    schoolId: school,
    assignmentId: { type: String, required: true, index: true },
    studentId: { type: String, required: true },
    studentName: { type: String, default: '' },
    className: { type: String, default: '' },
    submittedAt: String,
    status: { type: String, enum: ['pending', 'submitted', 'late', 'graded'], default: 'pending' },
    textContent: String,
    fileName: String,
    marks: Number,
    feedback: String,
  },
  { timestamps: true },
);
submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

/** A teacher's own leave request. */
const teacherLeaveSchema = new Schema(
  {
    schoolId: school,
    teacherUserId: { type: String, required: true, index: true },
    type: { type: String, enum: ['casual', 'sick', 'earned', 'special'], default: 'casual' },
    fromDate: { type: String, default: '' },
    toDate: { type: String, default: '' },
    days: { type: Number, default: 1 },
    reason: { type: String, default: '' },
    appliedOn: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    decidedBy: String,
    remarks: String,
    rejectionReason: String,
    substituteTeacher: String,
    referenceNumber: { type: String, default: '' },
  },
  { timestamps: true },
);

export type AssignmentDoc = InferSchemaType<typeof teacherAssignmentSchema>;
export const TeacherClassModel = model('TeacherClassAssignment', assignmentSchema);
export const TeacherHomeworkModel = model('TeacherHomework', homeworkSchema);
export const TeacherAssignmentModel = model('TeacherAssignment', teacherAssignmentSchema);
export const SubmissionModel = model('AssignmentSubmission', submissionSchema);
export const TeacherLeaveModel = model('TeacherLeave', teacherLeaveSchema);
