import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { UserModel } from '../modules/user/user.model';
import { StudentModel } from '../modules/students/student.model';

/**
 * Parent login accounts are now auto-created when a student is admitted
 * (see students.service.ts createOrLinkParentAccount). Students admitted
 * before that existed have a `mobile` on file but no `parentUserId` and no
 * linked User. This walks every such student, per school, and creates or
 * links a parent account exactly like the live code path does — reusing
 * one account per mobile number so siblings share a login.
 */
async function main(): Promise<void> {
  await connectDb();

  const students = await StudentModel.find({
    parentUserId: null,
    mobile: { $ne: '' },
  });

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const student of students) {
    const schoolId = String(student.schoolId);
    const mobile = student.mobile;
    if (!mobile) {
      skipped += 1;
      continue;
    }

    const existing = await UserModel.findOne({ schoolId, mobile, role: 'parent' });
    if (existing) {
      student.parentUserId = existing._id as typeof student.parentUserId;
      await student.save();
      linked += 1;
      continue;
    }

    const tempPassword = randomUUID().slice(0, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const user = await UserModel.create({
      name: `Parent of ${student.name}`,
      username: mobile,
      mobile,
      role: 'parent',
      passwordHash,
      schoolId,
      active: true,
      mustChangePassword: true,
    });
    student.parentUserId = user._id as typeof student.parentUserId;
    await student.save();
    created += 1;
    logger.info(`Created parent account for mobile ${mobile} (student=${String(student._id)}), temp password: ${tempPassword}`);
  }

  logger.info(`Backfill done. Accounts created: ${created}, linked to existing sibling account: ${linked}, skipped (no mobile): ${skipped}`);
  await disconnectDb();
}

main().catch((err) => {
  logger.error(err, 'Backfill failed');
  process.exit(1);
});
