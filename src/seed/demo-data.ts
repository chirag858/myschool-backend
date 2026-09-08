/**
 * Demo data for the last ~5 weeks, so the app shows a realistic school rather
 * than empty reports.
 *
 * Separate from `seed.ts` on purpose: that script builds the STRUCTURE (school,
 * classes, users, fee heads) and its dated rows sit in April-May 2025, which is
 * over a year behind "today" - every attendance report, dashboard KPI and marks
 * sheet therefore renders as zero. This script only adds dated activity on top
 * of whatever structure already exists, and every write is an upsert keyed on
 * its natural key, so it can be re-run to roll the window forward without
 * duplicating anything.
 *
 * Run: `npm run seed:demo`
 */
import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { AttendanceModel } from '../modules/attendance/attendance.models';
import { ExamMarkModel, ExamModel } from '../modules/exams/exams.models';
import { SchoolModel } from '../modules/school/school.model';
import { StaffAttendanceModel, StaffModel } from '../modules/staff/staff.models';
import { StudentModel } from '../modules/students/student.model';
import {
  HomeworkSubmissionModel,
  SubmissionModel,
  TeacherAssignmentModel,
  TeacherHomeworkModel,
} from '../modules/teacher/teacher.models';
import { UserModel } from '../modules/user/user.model';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

/** Sunday only - the school runs a six-day week (DAYS_OF_WEEK is mon..sat). */
const isHoliday = (d: Date): boolean => d.getDay() === 0;

/** How far back the demo window runs. */
const WINDOW_DAYS = 35;

/**
 * Deterministic pseudo-random in [0,1) from a string key. Re-running the script
 * must not reshuffle every student's history, or attendance percentages would
 * change on each run and nothing could be checked against a previous look.
 */
function seededRandom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Weighted so a register reads like a real one rather than a coin flip. */
function attendanceStatus(key: string): 'present' | 'absent' | 'leave' | 'late' {
  const r = seededRandom(key);
  if (r < 0.9) return 'present';
  if (r < 0.955) return 'absent';
  if (r < 0.98) return 'late';
  return 'leave';
}

const HOMEWORK = [
  { subject: 'Mathematics', title: 'Fractions practice', description: 'Exercise 4.2, questions 1-12.', back: 3 },
  { subject: 'English', title: 'Reading comprehension', description: 'Chapter 6 - answer the questions at the end.', back: 6 },
  { subject: 'Science', title: 'Plant parts diagram', description: 'Draw and label a flowering plant.', back: 10 },
  { subject: 'Mathematics', title: 'Word problems', description: 'Worksheet 5, all sums.', back: 14 },
];

async function main(): Promise<void> {
  await connectDb();

  const school = await SchoolModel.findOne({ code: 'MSC' }).lean();
  if (!school) {
    logger.error('No school with code MSC - run `npm run seed` first.');
    await disconnectDb();
    process.exit(1);
  }
  const schoolId = school._id;

  const today = new Date();
  const days: Date[] = [];
  for (let i = WINDOW_DAYS; i >= 0; i -= 1) {
    const d = addDays(today, -i);
    if (!isHoliday(d)) days.push(d);
  }
  logger.info(
    `Demo window: ${iso(days[0]!)} to ${iso(days[days.length - 1]!)} (${String(days.length)} school days)`,
  );

  // -- Student attendance ------------------------------------------------
  const students = await StudentModel.find({ schoolId }).lean();
  let attRows = 0;
  for (const day of days) {
    const date = iso(day);
    await Promise.all(
      students.map((s) => {
        attRows += 1;
        return AttendanceModel.updateOne(
          { schoolId, studentId: s._id, date },
          {
            $set: {
              schoolId,
              studentId: s._id,
              date,
              status: attendanceStatus(`${String(s._id)}:${date}`),
              className: s.className,
              section: s.section,
              markedBy: 'Class Teacher',
            },
          },
          { upsert: true },
        );
      }),
    );
  }
  logger.info(`Student attendance: ${String(attRows)} rows across ${String(students.length)} students`);

  // -- Staff attendance --------------------------------------------------
  const staff = await StaffModel.find({ schoolId }).lean();
  let staffRows = 0;
  for (const day of days) {
    const date = iso(day);
    await Promise.all(
      staff.map((st) => {
        const status = attendanceStatus(`staff:${String(st._id)}:${date}`);
        staffRows += 1;
        return StaffAttendanceModel.updateOne(
          { schoolId, staffId: String(st._id), date },
          {
            $set: {
              schoolId,
              staffId: String(st._id),
              date,
              status,
              timeIn: status === 'absent' ? undefined : status === 'late' ? '09:25' : '08:45',
              timeOut: status === 'absent' ? undefined : '15:30',
            },
          },
          { upsert: true },
        );
      }),
    );
  }
  logger.info(`Staff attendance: ${String(staffRows)} rows across ${String(staff.length)} staff`);

  // -- Homework, assignments and their submissions -----------------------
  const teacher = await UserModel.findOne({ schoolId, role: 'teacher' }).lean();
  if (teacher) {
    const tid = String(teacher._id);
    const classStudents = students.filter((s) => s.className === 'Class 1' && s.section === 'A');

    for (const hw of HOMEWORK) {
      const assigned = iso(addDays(today, -hw.back));
      const due = iso(addDays(today, -hw.back + 2));
      const doc = await TeacherHomeworkModel.findOneAndUpdate(
        { schoolId, teacherUserId: tid, title: hw.title },
        {
          $set: {
            schoolId,
            teacherUserId: tid,
            classKey: 'Class 1-A',
            subject: hw.subject,
            title: hw.title,
            description: hw.description,
            assignedDate: assigned,
            dueDate: due,
            homeworkType: 'daily',
            submissions: classStudents.length,
            createdBy: 'Teacher',
            createdById: tid,
            editHistory: [],
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (!doc) continue;

      // Most in, a couple late, the odd one still outstanding.
      await Promise.all(
        classStudents.map((s, i) => {
          const r = seededRandom(`hw:${hw.title}:${String(s._id)}`);
          const status = r < 0.6 ? 'graded' : r < 0.8 ? 'submitted' : r < 0.92 ? 'late' : 'pending';
          const graded = status === 'graded';
          return HomeworkSubmissionModel.updateOne(
            { homeworkId: String(doc._id), studentId: String(s._id) },
            {
              $set: {
                schoolId,
                homeworkId: String(doc._id),
                studentId: String(s._id),
                studentName: s.name,
                rollNo: Number(s.rollNumber) || i + 1,
                status,
                submittedAt: status === 'pending' ? undefined : `${due}T09:15:00.000Z`,
                marks: graded
                  ? 7 + Math.round(seededRandom(`m:${hw.title}:${String(s._id)}`) * 3)
                  : undefined,
                remark: graded ? 'Well presented.' : undefined,
              },
            },
            { upsert: true },
          );
        }),
      );
    }
    logger.info(
      `Homework: ${String(HOMEWORK.length)} items with submissions for ${String(classStudents.length)} students`,
    );

    const assignment = await TeacherAssignmentModel.findOneAndUpdate(
      { schoolId, teacherUserId: tid, title: 'Solar system model' },
      {
        $set: {
          schoolId,
          teacherUserId: tid,
          classKey: 'Class 1-A',
          subject: 'Science',
          title: 'Solar system model',
          description: 'Build a model of the solar system.',
          instructions: 'Submit a photo and a short write-up.',
          maxMarks: 20,
          assignedDate: iso(addDays(today, -12)),
          dueDate: iso(addDays(today, 3)),
          submissionType: 'both',
          status: 'active',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (assignment) {
      await Promise.all(
        classStudents.map((s) => {
          const r = seededRandom(`as:${String(s._id)}`);
          const status = r < 0.5 ? 'graded' : r < 0.75 ? 'submitted' : 'pending';
          return SubmissionModel.updateOne(
            { assignmentId: String(assignment._id), studentId: String(s._id) },
            {
              $set: {
                schoolId,
                assignmentId: String(assignment._id),
                studentId: String(s._id),
                studentName: s.name,
                className: 'Class 1-A',
                status,
                submittedAt:
                  status === 'pending' ? undefined : `${iso(addDays(today, -4))}T10:00:00.000Z`,
                textContent: status === 'pending' ? undefined : 'Model built with clay and wire.',
                marks:
                  status === 'graded' ? 14 + Math.round(seededRandom(`am:${String(s._id)}`) * 6) : undefined,
                feedback: status === 'graded' ? 'Good effort - label the planets next time.' : undefined,
              },
            },
            { upsert: true },
          );
        }),
      );
      logger.info('Assignment: 1 item with submissions');
    }
  }

  // -- Exam marks --------------------------------------------------------
  // Fill the mark rows of every exam already open for entry or published, so
  // the marks sheet, results and report cards all have something real.
  const exams = await ExamModel.find({
    schoolId,
    status: { $in: ['marks_entry', 'published'] },
  }).lean();

  let markRows = 0;
  for (const exam of exams) {
    const patternByClass = (exam.patternByClass ?? {}) as Record<
      string,
      { maxTheory?: number; maxPractical?: number; maxInternal?: number }
    >;

    for (const classKey of exam.classes ?? []) {
      const [className, section] = String(classKey).split('-');
      const inClass = students.filter(
        (s) => s.className === className && (section === undefined || s.section === section),
      );
      if (inClass.length === 0) continue;

      const p = patternByClass[String(classKey)] ?? Object.values(patternByClass)[0] ?? {};
      const maxT = p.maxTheory ?? 80;
      const maxP = p.maxPractical ?? 20;
      const maxI = p.maxInternal ?? 0;

      for (const subject of ['Mathematics', 'Science', 'English']) {
        for (const s of inClass) {
          const r = seededRandom(`ex:${String(exam._id)}:${subject}:${String(s._id)}`);
          markRows += 1;
          await ExamMarkModel.updateOne(
            { examId: exam._id, subjectId: subject, studentId: s._id },
            {
              $set: {
                schoolId,
                examId: exam._id,
                classKey: String(classKey),
                subjectId: subject,
                studentId: s._id,
                // 45-95% of each component, so grades spread across the bands.
                theory: Math.round(maxT * (0.45 + r * 0.5)),
                practical: Math.round(maxP * (0.6 + r * 0.35)),
                internal: maxI > 0 ? Math.round(maxI * (0.7 + r * 0.3)) : 0,
                isAbsent: false,
                // A published exam is finished; one still in entry is not.
                submitted: exam.status === 'published',
              },
            },
            { upsert: true },
          );
        }
      }
    }
  }
  logger.info(`Exam marks: ${String(markRows)} rows across ${String(exams.length)} exams`);

  logger.info('Demo data complete.');
  await disconnectDb();
}

main().catch((err: unknown) => {
  logger.error('Demo data failed', err);
  process.exit(1);
});
