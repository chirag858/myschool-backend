/**
 * Timetable demo data — a full week for every class, and therefore a real
 * schedule for every teacher.
 *
 * All 13 `TimetableClass` documents exist but carry ZERO slots, so the master
 * timetable, a class's own timetable, and every teacher's "my schedule" are
 * empty grids. Worse, `getMyTeachingAssignments` derives what a teacher
 * teaches FROM these slots, so with none of them a teacher also has no
 * classes, no marks-entry duties and no exam rows — the whole teacher app
 * hangs off this one collection.
 *
 * Generates a conflict-free grid: within a day-and-period no teacher and no
 * room is used twice, which is exactly what the app's own conflict detector
 * checks for. Idempotent — a class's slots are replaced wholesale on each run,
 * keyed on (classId, section).
 *
 * Run: `npm run seed:timetable`
 */
import bcrypt from 'bcryptjs';

import { ClassModel, SectionModel } from '../modules/academics/academics.models';
import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { SchoolModel } from '../modules/school/school.model';
import { StaffModel } from '../modules/staff/staff.models';
import { UserModel } from '../modules/user/user.model';
import {
  DAY_OF_WEEK,
  PeriodModel,
  RoomModel,
  SubjectAssignmentModel,
  SubjectModel,
  TimetableClassModel,
} from '../modules/timetable/timetable.models';

/** Deterministic [0,1) so a re-run produces the same timetable. */
function rnd(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Distinct colours so a week grid is readable at a glance. */
const SUBJECT_COLOURS: Record<string, string> = {
  Maths: '#5b8cff',
  English: '#22c55e',
  Hindi: '#f59e0b',
  Science: '#ec4899',
};
const FALLBACK_COLOUR = '#8b5cf6';

async function main(): Promise<void> {
  await connectDb();
  const school = await SchoolModel.findOne({ code: 'MSC' }).lean();
  if (!school) {
    logger.error('No school with code MSC - run `npm run seed` first.');
    await disconnectDb();
    process.exit(1);
  }
  const schoolId = school._id;

  const [classes, sections, periods, subjects] = await Promise.all([
    ClassModel.find({ schoolId }).sort({ order: 1 }).lean(),
    SectionModel.find({ schoolId }).lean(),
    PeriodModel.find({ schoolId }).sort({ order: 1 }).lean(),
    SubjectModel.find({ schoolId }).lean(),
  ]);

  // A school gives each class its own room, and needs enough teachers to staff
  // every section at once. The seeded school had 3 rooms and 5 teachers for 14
  // sections, so most periods could not be scheduled at all — provision what is
  // missing before building the grid.
  for (const sec of sections) {
    const cls = classes.find((c) => String(c._id) === String(sec.classId));
    if (!cls) continue;
    const name = `${cls.name}-${String(sec.name)}`;
    await RoomModel.updateOne(
      { schoolId, name },
      { $set: { schoolId, name, type: 'classroom', capacity: 40, floor: 'G', status: 'available' } },
      { upsert: true },
    );
  }

  const TEACHER_NAMES = [
    'Meena Iyer', 'Vikram Rao', 'Sunita Joshi', 'Arun Kapoor', 'Deepa Menon',
    'Sanjay Bhatia', 'Kavita Reddy', 'Manoj Tiwari', 'Ritu Chauhan', 'Alok Pandey',
    'Neha Saxena', 'Gaurav Malhotra', 'Pooja Nair', 'Rakesh Sinha',
    'Shalini Gupta', 'Ajay Kulkarni', 'Farhan Ali', 'Divya Menon',
  ];
  const seededTeachers = await StaffModel.countDocuments({
    schoolId,
    designation: { $in: ['teacher', 'TGT', 'PRT', 'PGT'] },
    employeeId: { $not: /^EMP01/ },
  });
  // Each subject needs enough specialists to cover the sections taking it in
  // the same period (`sections / subjects`, rounded up), across all subjects —
  // otherwise a lesson is dropped whenever every specialist is already busy.
  const wanted = Math.ceil(sections.length / Math.max(subjects.length, 1)) * subjects.length;
  // Counted against the ORIGINAL staff only, so a re-run tops up to the same
  // target instead of rewriting the first few generated teachers.
  const needed = Math.max(0, wanted - seededTeachers);
  for (let i = 0; i < Math.min(needed, TEACHER_NAMES.length); i += 1) {
    const name = TEACHER_NAMES[i]!;
    const employeeId = `EMP${String(100 + i).padStart(4, '0')}`;
    await StaffModel.updateOne(
      { schoolId, employeeId },
      {
        $set: {
          schoolId,
          employeeId,
          name,
          designation: 'teacher',
          designationLabel: 'Teacher',
          department: 'teaching',
          departmentLabel: 'Teaching',
          category: 'teaching',
          employmentType: 'full_time',
          status: 'active',
          mobile: `9${String(700000000 + i * 137)}`,
          email: `${name.toLowerCase().replace(/\s+/g, '.')}@msc.test`,
          joiningDate: '2024-06-01',
          basic: 32000,
          netSalary: 38000,
        },
      },
      { upsert: true },
    );
  }

  // Every generated teacher needs a LOGIN, not just a staff record.
  // `timetableService.getAllTeachingAssignments` resolves each slot's teacher
  // through `Staff.userId` and SKIPS the slot when there is none — so without
  // this, 369 of the 504 generated slots vanished from every surface built on
  // teaching assignments (marks overview, teacher workload, exam duties), even
  // though the timetable itself rendered fine.
  const password = await bcrypt.hash('demo1234', 10);
  const unlinked = await StaffModel.find({
    schoolId,
    designation: { $in: ['teacher', 'TGT', 'PRT', 'PGT'] },
    $or: [{ userId: { $exists: false } }, { userId: null }],
  });
  for (const member of unlinked) {
    const username = String(member.employeeId).toLowerCase();
    const email = `${username}@msc.test`;
    // Reuse a login that already carries this username/email rather than
    // failing on the unique index when the script is re-run.
    const user =
      (await UserModel.findOne({ schoolId, $or: [{ username }, { email }] })) ??
      (await UserModel.create({
        name: member.name,
        username,
        email,
        mobile: member.mobile,
        role: 'teacher',
        passwordHash: password,
        schoolId,
        active: true,
      }));
    member.userId = user._id;
    await member.save();
  }
  if (unlinked.length > 0) {
    logger.info(`Teacher logins created/linked: ${String(unlinked.length)} (password: demo1234)`);
  }

  const [rooms, staff] = await Promise.all([
    RoomModel.find({ schoolId }).lean(),
    StaffModel.find({ schoolId, designation: { $in: ['teacher', 'TGT', 'PRT', 'PGT'] } }).lean(),
  ]);
  logger.info(`Rooms: ${String(rooms.length)} | Teachers: ${String(staff.length)} for ${String(sections.length)} sections`);

  // Only teaching periods carry a lesson — a break or lunch is not scheduled.
  const teachingPeriods = periods.filter((p) => p.type === 'class');
  if (teachingPeriods.length === 0 || subjects.length === 0 || staff.length === 0 || rooms.length === 0) {
    logger.error(
      `Missing prerequisites: periods=${String(teachingPeriods.length)} subjects=${String(subjects.length)} staff=${String(staff.length)} rooms=${String(rooms.length)}`,
    );
    await disconnectDb();
    process.exit(1);
  }

  logger.info(
    `Building ${String(DAY_OF_WEEK.length)} days x ${String(teachingPeriods.length)} periods for ${String(sections.length)} sections`,
  );

  // A slot is a lesson; these track who and what is already busy in a given
  // (day, period) so the generated week has no conflict for the app's own
  // detector to find.
  const teacherBusy = new Set<string>();
  const roomBusy = new Set<string>();

  // Split the staff room into subject specialists, the way a school is
  // actually staffed — each teacher covers one subject across several classes
  // rather than every subject for one class.
  // With the section stagger, a period needs about `sections / subjects`
  // teachers of any one subject at the same time; give each subject that many
  // (rounded up) so no lesson is dropped for want of a free specialist.
  const perSubject = Math.max(1, Math.ceil(sections.length / subjects.length));
  const specialists = new Map<string, (typeof staff)[number][]>();
  for (let i = 0; i < subjects.length; i += 1) {
    const pool = staff.slice(i * perSubject, (i + 1) * perSubject);
    specialists.set(String(subjects[i]!._id), pool.length > 0 ? pool : staff);
  }

  let totalSlots = 0;
  let assignments = 0;

  let sectionIndex = -1;
  for (const cls of classes) {
    const clsSections = sections.filter((s) => String(s.classId) === String(cls._id));

    for (const sec of clsSections) {
      sectionIndex += 1;
      const classKey = `${cls.name}-${String(sec.name)}`;
      const homeRoom = rooms.find((r) => r.name === classKey);
      const slots: Record<string, unknown>[] = [];

      // One teacher owns a subject for a class all week — a class does not get
      // a different Maths teacher on Tuesday. Teachers are drawn from the pool
      // that SPECIALISES in that subject, so nobody ends up teaching Maths,
      // English and Science to the same class the way a naive round-robin does.
      const subjectTeacher = new Map<string, (typeof staff)[number]>();
      for (const subj of subjects) {
        const pool = specialists.get(String(subj._id)) ?? staff;
        const idx = Math.floor(rnd(`t:${classKey}:${subj.name}`) * pool.length);
        subjectTeacher.set(String(subj._id), pool[idx]!);
      }

      for (const day of DAY_OF_WEEK) {
        for (let pi = 0; pi < teachingPeriods.length; pi += 1) {
          const period = teachingPeriods[pi]!;
          const dayKey = `${day}:${String(period._id)}`;

          // Rotate by day so a class is not taught the same sequence six days
          // running, AND by section so that in any one period the 14 sections
          // are spread across the subjects. Without the section offset every
          // class wants the same subject at the same time, and one subject's
          // teachers cannot cover the whole school in a single period.
          const subjIndex = (pi + DAY_OF_WEEK.indexOf(day) + sectionIndex) % subjects.length;
          const subject = subjects[subjIndex]!;
          const teacher = subjectTeacher.get(String(subject._id))!;

          // If this teacher is already teaching elsewhere this period, fall back
          // to another teacher OF THE SAME SUBJECT — falling back to "any free
          // teacher" would quietly undo the specialism and leave everyone
          // teaching all four subjects.
          let chosen = teacher;
          if (teacherBusy.has(`${dayKey}:${String(teacher._id)}`)) {
            const pool = specialists.get(String(subject._id)) ?? [];
            const free = pool.find((s) => !teacherBusy.has(`${dayKey}:${String(s._id)}`));
            if (!free) continue; // every specialist is busy — a free period
            chosen = free;
          }

          // A class sits in its OWN room all week, as a school actually runs;
          // "first free room" would have the same class roaming the building.
          const room = homeRoom ?? rooms.find((r) => !roomBusy.has(`${dayKey}:${String(r._id)}`));
          if (!room) continue; // no room for this period

          teacherBusy.add(`${dayKey}:${String(chosen._id)}`);
          roomBusy.add(`${dayKey}:${String(room._id)}`);

          slots.push({
            classId: String(cls._id),
            section: String(sec.name),
            day,
            periodId: String(period._id),
            subjectId: String(subject._id),
            subjectName: subject.name,
            subjectColor: SUBJECT_COLOURS[String(subject.name)] ?? FALLBACK_COLOUR,
            // The slot's teacher is the STAFF id, not the login User id — every
            // read path (`getMySchedule`, `getMyTeachingAssignments`) resolves
            // a teacher's login to their staff record first.
            teacherId: String(chosen._id),
            teacherName: chosen.name,
            roomId: String(room._id),
            roomName: room.name,
          });
          totalSlots += 1;
        }
      }

      await TimetableClassModel.updateOne(
        { schoolId, classId: String(cls._id), section: String(sec.name) },
        { $set: { schoolId, classId: String(cls._id), section: String(sec.name), slots, published: true } },
        { upsert: true },
      );

      // Keep the subject-assignment view (who teaches what, per class) in step
      // with the grid that was just generated.
      for (const [subjectId, teacher] of subjectTeacher) {
        assignments += 1;
        await SubjectAssignmentModel.updateOne(
          { schoolId, classId: String(cls._id), section: String(sec.name), subjectId },
          { $set: { schoolId, classId: String(cls._id), section: String(sec.name), subjectId, teacherId: String(teacher._id) } },
          { upsert: true },
        );
      }
    }
  }

  logger.info(`Timetable: ${String(totalSlots)} slots across ${String(sections.length)} sections, published`);
  logger.info(`Subject assignments: ${String(assignments)}`);

  // Report the per-teacher load, since that is what the teacher app shows.
  const built = await TimetableClassModel.find({ schoolId }).lean();
  const load = new Map<string, number>();
  for (const tt of built) {
    for (const s of tt.slots) {
      const id = String((s as { teacherId?: string }).teacherId ?? '');
      load.set(id, (load.get(id) ?? 0) + 1);
    }
  }
  for (const s of staff) {
    logger.info(`  ${s.name}: ${String(load.get(String(s._id)) ?? 0)} periods/week`);
  }

  await disconnectDb();
}

main().catch((err: unknown) => {
  logger.error('Timetable demo data failed', err);
  process.exit(1);
});
