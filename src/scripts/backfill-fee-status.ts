import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { StudentModel } from '../modules/students/student.model';
import { syncStudentFeeStatus } from '../modules/fee/fee.service';

async function main(): Promise<void> {
  await connectDb();
  const students = await StudentModel.find({}, { schoolId: 1 }).lean();
  let done = 0;
  for (const s of students) {
    await syncStudentFeeStatus(String(s.schoolId), String(s._id));
    done += 1;
  }
  logger.info(`Backfilled feeStatus for ${done} students`);
  await disconnectDb();
}

main().catch((err) => {
  logger.error(err, 'Backfill failed');
  process.exit(1);
});
