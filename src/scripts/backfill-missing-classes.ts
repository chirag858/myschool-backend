import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { ClassModel, SectionModel } from '../modules/academics/academics.models';
import { StudentModel } from '../modules/students/student.model';

/**
 * Students can carry a className/section that was never added as a real
 * Class/Section in Admin > Academics (e.g. imported/legacy data). That makes
 * them invisible in every class picker across the app, which reads from
 * Academics, not from Student records. This backfills the missing Class +
 * Section documents from whatever className/section combos actually exist
 * on real students, per school, so the two stay in sync.
 */
async function main(): Promise<void> {
  await connectDb();

  const schoolIds = await StudentModel.distinct('schoolId');
  let classesCreated = 0;
  let sectionsCreated = 0;

  for (const schoolId of schoolIds) {
    const existingClasses = await ClassModel.find({ schoolId }).lean();
    const classByName = new Map(existingClasses.map((c) => [c.name, c]));
    let maxOrder = existingClasses.reduce((m, c) => Math.max(m, c.order ?? 0), 0);

    const combos = await StudentModel.aggregate<{
      _id: { className: string; section: string };
    }>([
      { $match: { schoolId, className: { $ne: '' }, section: { $ne: '' } } },
      { $group: { _id: { className: '$className', section: '$section' } } },
    ]);

    for (const combo of combos) {
      const { className, section } = combo._id;
      if (!className || !section) continue;

      let cls = classByName.get(className);
      if (!cls) {
        maxOrder += 1;
        cls = await ClassModel.create({ schoolId, name: className, order: maxOrder });
        classByName.set(className, cls);
        classesCreated += 1;
        logger.info(`Created missing class "${className}" (schoolId=${String(schoolId)})`);
      }

      const sectionExists = await SectionModel.exists({
        schoolId,
        classId: cls._id,
        name: section,
      });
      if (!sectionExists) {
        await SectionModel.create({
          schoolId,
          classId: cls._id,
          name: section,
          maxCapacity: 40,
        });
        sectionsCreated += 1;
        logger.info(`Created missing section "${className}-${section}" (schoolId=${String(schoolId)})`);
      }
    }
  }

  logger.info(`Backfill done. Classes created: ${classesCreated}, sections created: ${sectionsCreated}`);
  await disconnectDb();
}

main().catch((err) => {
  logger.error(err, 'Backfill failed');
  process.exit(1);
});
