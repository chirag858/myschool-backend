import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { ClassModel, SectionModel } from '../modules/academics/academics.models';
import { TeacherClassModel } from '../modules/teacher/teacher.models';
import { UserModel } from '../modules/user/user.model';

/**
 * The class-incharge refactor added `Section.classTeacherId` as the single
 * source of "which class does this teacher manage" — schools with existing
 * data have no incharge set anywhere yet, which would leave every teacher's
 * My Classes/My Students empty until an admin manually assigns one. This
 * gives each teacher without an incharge class their first
 * `TeacherClassAssignment` row's class, skipping any section that already
 * has a different incharge.
 */
async function main(): Promise<void> {
  await connectDb();

  let assigned = 0;
  let skippedAlreadyIncharge = 0;
  let skippedSectionTaken = 0;

  const teachers = await UserModel.find({ role: 'teacher' }).lean();
  for (const teacher of teachers) {
    const schoolId = teacher.schoolId;
    if (!schoolId) continue;
    const teacherId = String(teacher._id);

    const alreadyIncharge = await SectionModel.exists({ schoolId, classTeacherId: teacherId });
    if (alreadyIncharge) {
      skippedAlreadyIncharge += 1;
      continue;
    }

    const firstAssignment = await TeacherClassModel.findOne({ schoolId, teacherUserId: teacherId }).lean();
    if (!firstAssignment) continue;

    const cls = await ClassModel.findOne({ schoolId, name: firstAssignment.className }).lean();
    if (!cls) continue;

    const section = await SectionModel.findOne({ schoolId, classId: cls._id, name: firstAssignment.section });
    if (!section) continue;
    if (section.classTeacherId) {
      skippedSectionTaken += 1;
      continue;
    }

    section.set({ classTeacherId: teacherId, classTeacherName: teacher.name });
    await section.save();
    assigned += 1;
    logger.info(`Set ${teacher.name} as incharge of ${firstAssignment.className}-${firstAssignment.section}`);
  }

  logger.info(
    `Backfill done. Assigned: ${assigned}, already had incharge: ${skippedAlreadyIncharge}, section already taken: ${skippedSectionTaken}`,
  );
  await disconnectDb();
}

main().catch((err) => {
  logger.error(err, 'Backfill failed');
  process.exit(1);
});
