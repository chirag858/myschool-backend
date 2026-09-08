/**
 * Roster + records demo data — fills the school out to a believable size and
 * hangs realistic records off it.
 *
 * `demo-data.ts` covers dated ACTIVITY (attendance, homework, marks) for the
 * students that already exist. This script covers the STRUCTURE around them:
 * classes that hold 18-32 students rather than one or two, complete student
 * profiles, fee receipts, library issues, hostel allocation, inventory
 * movement, certificates, holidays and gate records — the things that make
 * every list screen in the app look like a working school instead of a demo
 * with one row.
 *
 * Idempotent: every write is an upsert on a natural key, so re-running tops the
 * data up rather than duplicating it. Run `seed:demo` afterwards to give any
 * newly created student their attendance and marks history.
 *
 * Run: `npm run seed:roster`
 */
import { ClassModel, HolidayModel, SectionModel } from '../modules/academics/academics.models';
import { CertificateModel } from '../modules/certificates/certificates.models';
import { connectDb, disconnectDb } from '../config/db';
import { FeeHeadModel, FeeStructureModel, ReceiptModel } from '../modules/fee/fee.models';
import { PickupModel, VisitorModel } from '../modules/gate-manager/gate-manager.models';
import { BuildingModel, HostelStudentModel, RoomModel } from '../modules/hostel/hostel.models';
import {
  InventoryItemModel,
  PurchaseModel,
  StockIssueModel,
  StockMovementModel,
  VendorModel,
} from '../modules/inventory/inventory.models';
import { ItemRequestModel, StockMismatchModel } from '../modules/inventory/inventory-requests.models';
import { BookCopyModel, BookModel, IssueModel, LibraryMemberModel } from '../modules/library/library.models';
import { logger } from '../lib/logger';
import { SchoolModel } from '../modules/school/school.model';
import { StaffModel } from '../modules/staff/staff.models';
import { StudentModel } from '../modules/students/student.model';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

/** Deterministic [0,1) from a key — re-runs must not reshuffle the school. */
function rnd(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
const pick = <T>(key: string, list: readonly T[]): T => list[Math.floor(rnd(key) * list.length)]!;
const between = (key: string, lo: number, hi: number): number => lo + Math.floor(rnd(key) * (hi - lo + 1));

const FIRST_M = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan', 'Shaurya', 'Atharv', 'Advik', 'Rudra', 'Kabir', 'Ayaan', 'Dhruv', 'Yuvan', 'Veer', 'Aryan'];
const FIRST_F = ['Aadhya', 'Ananya', 'Diya', 'Saanvi', 'Myra', 'Anika', 'Navya', 'Kiara', 'Ira', 'Riya', 'Pari', 'Aarohi', 'Avni', 'Siya', 'Meera', 'Tara', 'Ishita', 'Nitya'];
const SURNAMES = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Nair', 'Reddy', 'Patel', 'Mehta', 'Iyer', 'Chauhan', 'Joshi', 'Kapoor', 'Bhatia', 'Rao'];
const OCCUPATIONS = ['Business', 'Service', 'Teacher', 'Engineer', 'Doctor', 'Farmer', 'Shopkeeper', 'Government Service'];
const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'A-', 'O-'];
const CATEGORIES = ['general', 'obc', 'sc', 'st'];
const RELIGIONS = ['Hindu', 'Muslim', 'Sikh', 'Christian', 'Jain'];
const CITIES = ['Lucknow', 'Kanpur', 'Varanasi', 'Prayagraj', 'Gorakhpur'];

/** Target strength per section — a real school is not two children a class. */
const TARGET_PER_SECTION = 24;

/** Rough age for a class, so dates of birth are not nonsense. */
const AGE_FOR_CLASS: Record<string, number> = {
  Nursery: 4, LKG: 5, UKG: 6, 'Class 1': 7, 'Class 2': 8,
  IX: 15, X: 16, XI: 17, XII: 18,
};

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
  const year = today.getFullYear();
  const session = `${String(year)}-${String((year + 1) % 100).padStart(2, '0')}`;

  // ── Students: bring every section up to strength ──────────────────────
  const classes = await ClassModel.find({ schoolId }).lean();
  const sections = await SectionModel.find({ schoolId }).lean();
  let created = 0;
  let updated = 0;

  for (const cls of classes) {
    const clsSections = sections.filter((s) => String(s.classId) === String(cls._id));
    for (const sec of clsSections) {
      const classKey = `${cls.name}-${sec.name}`;
      const existing = await StudentModel.find({ schoolId, className: cls.name, section: sec.name }).lean();

      // Backfill the profile fields the original seed left blank, so student
      // detail screens are not a column of dashes.
      for (const s of existing) {
        if (s.dateOfBirth) continue;
        const age = AGE_FOR_CLASS[cls.name] ?? 10;
        updated += 1;
        await StudentModel.updateOne(
          { _id: s._id },
          {
            $set: {
              dateOfBirth: iso(new Date(year - age, between(`dob:${String(s._id)}`, 0, 11), between(`dobd:${String(s._id)}`, 1, 28))),
              bloodGroup: s.bloodGroup || pick(`bg:${String(s._id)}`, BLOOD),
              category: s.category || pick(`cat:${String(s._id)}`, CATEGORIES),
              religion: pick(`rel:${String(s._id)}`, RELIGIONS),
              nationality: 'Indian',
              sessionLabel: session,
              classKey,
            },
          },
        );
      }

      for (let i = existing.length; i < TARGET_PER_SECTION; i += 1) {
        const key = `${classKey}:${String(i)}`;
        const isMale = rnd(`g:${key}`) < 0.52;
        const first = pick(`f:${key}`, isMale ? FIRST_M : FIRST_F);
        const surname = pick(`s:${key}`, SURNAMES);
        const name = `${first} ${surname}`;
        const roll = String(i + 1);
        const admissionNumber = `ADM-${String(year)}-${cls.name.replace(/\s+/g, '')}${sec.name}-${roll.padStart(3, '0')}`;
        const age = AGE_FOR_CLASS[cls.name] ?? 10;
        const mobile = `9${String(between(`mob:${key}`, 100000000, 999999999))}`;

        created += 1;
        await StudentModel.updateOne(
          { schoolId, admissionNumber },
          {
            $set: {
              schoolId,
              admissionNumber,
              rollNumber: roll,
              name,
              fatherName: `${pick(`ff:${key}`, FIRST_M)} ${surname}`,
              classId: cls._id,
              className: cls.name,
              sectionId: sec._id,
              section: sec.name,
              classKey,
              admissionType: 'new',
              feeStatus: pick(`fs:${key}`, ['paid', 'paid', 'paid', 'partial', 'pending']),
              profileStatus: 'active',
              mobile,
              sessionLabel: session,
              dateOfBirth: iso(new Date(year - age, between(`dob:${key}`, 0, 11), between(`dobd:${key}`, 1, 28))),
              gender: isMale ? 'male' : 'female',
              bloodGroup: pick(`bg:${key}`, BLOOD),
              category: pick(`cat:${key}`, CATEGORIES),
              religion: pick(`rel:${key}`, RELIGIONS),
              nationality: 'Indian',
              aadhaar: String(between(`aad:${key}`, 100000000000, 999999999999)),
              parents: {
                fatherName: `${pick(`ff:${key}`, FIRST_M)} ${surname}`,
                fatherMobile: mobile,
                fatherOccupation: pick(`fo:${key}`, OCCUPATIONS),
                motherName: `${pick(`mf:${key}`, FIRST_F)} ${surname}`,
                motherMobile: `9${String(between(`mmob:${key}`, 100000000, 999999999))}`,
                motherOccupation: pick(`mo:${key}`, OCCUPATIONS),
              },
              address: {
                line1: `${String(between(`h:${key}`, 1, 250))}, ${pick(`st:${key}`, ['Gandhi Nagar', 'Civil Lines', 'Model Town', 'Ashok Vihar'])}`,
                city: pick(`ci:${key}`, CITIES),
                state: 'Uttar Pradesh',
                pinCode: String(between(`pin:${key}`, 200001, 285999)),
              },
            },
          },
          { upsert: true },
        );
      }
    }
  }
  logger.info(`Students: ${String(created)} created, ${String(updated)} profiles completed`);

  const students = await StudentModel.find({ schoolId }).lean();

  // ── Fee receipts ──────────────────────────────────────────────────────
  // Every student who is not "pending" has paid something, so the fee screens,
  // the daily collection scroll and the defaulter list all have real figures.
  const heads = await FeeHeadModel.find({ schoolId }).lean();
  const structures = await FeeStructureModel.find({ schoolId, session: { $exists: true } }).lean();
  const monthlyFor = (className: string): { name: string; amount: number }[] =>
    heads
      .map((h) => {
        const st = structures.find((s) => String(s.feeHeadId) === String(h._id));
        const amounts = (st?.amounts ?? {}) as Record<string, number>;
        return { name: h.name, amount: amounts[className] ?? 0 };
      })
      .filter((h) => h.amount > 0);

  const MONTHS = ['April', 'May', 'June', 'July', 'August'];
  let receipts = 0;
  let receiptSeq = await ReceiptModel.countDocuments({ schoolId });

  for (const s of students) {
    if (s.feeStatus === 'pending') continue;
    const breakdown = monthlyFor(s.className ?? '');
    if (breakDownEmpty(breakdown)) continue;
    const monthsPaid = s.feeStatus === 'paid' ? MONTHS : MONTHS.slice(0, 3);
    const amount = breakdown.reduce((sum, h) => sum + h.amount, 0) * monthsPaid.length;
    receiptSeq += 1;
    const receiptNumber = `RCP-${String(year)}-${String(receiptSeq).padStart(5, '0')}`;
    const paidOn = iso(addDays(today, -between(`rc:${String(s._id)}`, 5, 60)));

    receipts += 1;
    await ReceiptModel.updateOne(
      { schoolId, studentId: s._id, monthsCovered: monthsPaid },
      {
        $setOnInsert: {
          schoolId,
          receiptNumber,
          studentId: s._id,
          studentName: s.name,
          className: s.className,
          section: s.section,
          monthsCovered: monthsPaid,
          feeHeads: breakdown,
          amount,
          paymentMode: pick(`pm:${String(s._id)}`, ['cash', 'upi', 'cheque', 'online']),
          paymentDate: paidOn,
          generatedBy: 'Accountant',
          status: 'active',
        },
      },
      { upsert: true },
    );
  }
  logger.info(`Fee receipts: ${String(receipts)} students billed`);

  // ── Library ───────────────────────────────────────────────────────────
  const books = await BookModel.find({ schoolId }).lean();
  const copies = await BookCopyModel.find({ schoolId }).lean();
  const members = await LibraryMemberModel.find({ schoolId }).lean();
  let issues = 0;
  for (let i = 0; i < Math.min(copies.length, 8); i += 1) {
    const copy = copies[i]!;
    const book = books.find((b) => String(b._id) === String(copy.bookId));
    const member = members[i % Math.max(members.length, 1)];
    if (!book || !member) continue;
    const issued = addDays(today, -between(`li:${String(copy._id)}`, 3, 30));
    const due = addDays(issued, 14);
    const returned = rnd(`lr:${String(copy._id)}`) < 0.5;
    const overdue = !returned && due < today;
    issues += 1;
    await IssueModel.updateOne(
      { schoolId, copyId: copy._id, issueDate: iso(issued) },
      {
        $set: {
          schoolId,
          bookId: book._id,
          bookTitle: book.title,
          copyId: copy._id,
          barcode: copy.barcode,
          memberId: member._id,
          memberName: member.name,
          memberType: member.type,
          issueDate: iso(issued),
          dueDate: iso(due),
          returnDate: returned ? iso(addDays(due, -2)) : undefined,
          status: returned ? 'returned' : overdue ? 'overdue' : 'active',
          // ₹2/day, the rule the fine screen documents.
          fineAmount: overdue ? Math.ceil((today.getTime() - due.getTime()) / 86400000) * 2 : 0,
          fineStatus: 'pending',
        },
      },
      { upsert: true },
    );
  }
  logger.info(`Library: ${String(issues)} issues`);

  // ── Hostel ────────────────────────────────────────────────────────────
  const buildings = await BuildingModel.find({ schoolId }).lean();
  const rooms = await RoomModel.find({ schoolId }).lean();
  let allocated = 0;
  const seniors = students.filter((s) => ['IX', 'X', 'XI', 'XII'].includes(s.className ?? ''));
  for (let i = 0; i < Math.min(rooms.length * 2, seniors.length, 12); i += 1) {
    const room = rooms[i % Math.max(rooms.length, 1)];
    const s = seniors[i]!;
    if (!room) continue;
    const building = buildings.find((b) => String(b._id) === String(room.buildingId));
    const bedNumber = String((i % Math.max(room.totalBeds || 2, 1)) + 1);
    allocated += 1;
    await HostelStudentModel.updateOne(
      { schoolId, studentId: String(s._id) },
      {
        $set: {
          schoolId,
          studentId: String(s._id),
          studentName: s.name,
          className: `${s.className ?? ''}-${s.section ?? ''}`,
          buildingId: String(room.buildingId),
          buildingName: building?.name ?? room.buildingName,
          roomId: String(room._id),
          roomNumber: room.roomNumber,
          bedNumber,
          allocatedFrom: iso(addDays(today, -between(`ha:${String(s._id)}`, 30, 120))),
          monthlyFee: room.monthlyCharge || 3500,
          messIncluded: true,
          messMonthlyCharge: 2200,
          paymentStatus: pick(`hp:${String(s._id)}`, ['paid', 'paid', 'pending', 'overdue']),
          status: 'allocated',
        },
      },
      { upsert: true },
    );
  }
  logger.info(`Hostel: ${String(allocated)} students allocated`);

  // ── Inventory movement ────────────────────────────────────────────────
  const items = await InventoryItemModel.find({ schoolId }).lean();
  const vendors = await VendorModel.find({ schoolId }).lean();
  const staff = await StaffModel.find({ schoolId }).lean();
  let invRows = 0;

  for (const item of items) {
    const qty = between(`pq:${String(item._id)}`, 20, 120);
    const date = iso(addDays(today, -between(`pd:${String(item._id)}`, 5, 40)));
    const vendor = vendors[0];
    invRows += 1;
    await PurchaseModel.updateOne(
      { schoolId, invoiceNumber: `INV-${String(item._id).slice(-6)}` },
      {
        $set: {
          schoolId,
          purchaseDate: date,
          vendorName: vendor?.name ?? 'General Supplies',
          vendorId: vendor ? String(vendor._id) : undefined,
          invoiceNumber: `INV-${String(item._id).slice(-6)}`,
          invoiceDate: date,
          paymentMode: 'bank',
          taxPercent: 18,
          subtotal: qty * (item.unitPrice || 100),
          total: Math.round(qty * (item.unitPrice || 100) * 1.18),
          items: [{ itemId: String(item._id), name: item.name, quantity: qty, unitPrice: item.unitPrice || 100 }],
          addedBy: 'Store Keeper',
        },
      },
      { upsert: true },
    );

    await StockMovementModel.updateOne(
      { schoolId, itemId: String(item._id), date, type: 'in' },
      {
        $set: {
          schoolId,
          itemId: String(item._id),
          date,
          type: 'in',
          quantity: qty,
          balanceAfter: (item.currentStock || 0) + qty,
          reference: `INV-${String(item._id).slice(-6)}`,
          performedBy: 'Store Keeper',
        },
      },
      { upsert: true },
    );

    await InventoryItemModel.updateOne(
      { _id: item._id },
      { $set: { currentStock: (item.currentStock || 0) + qty, status: 'in_stock' } },
    );
  }

  if (items[0] && staff[0]) {
    await StockIssueModel.updateOne(
      { schoolId, issuedTo: staff[0].name, date: iso(addDays(today, -4)) },
      {
        $set: {
          schoolId,
          date: iso(addDays(today, -4)),
          issuedTo: staff[0].name,
          department: staff[0].department ?? 'teaching',
          purpose: 'Classroom supplies',
          itemsCount: 2,
          returnExpected: false,
          status: 'open',
          items: [{ itemId: String(items[0]._id), name: items[0].name, quantity: 5 }],
        },
      },
      { upsert: true },
    );

    await ItemRequestModel.updateOne(
      { schoolId, itemId: String(items[0]._id), requestedBy: staff[0].name },
      {
        $set: {
          schoolId,
          itemId: String(items[0]._id),
          itemName: items[0].name,
          category: items[0].category,
          quantity: 10,
          availableStock: items[0].currentStock ?? 0,
          unitPrice: items[0].unitPrice ?? 0,
          purpose: 'Replacement stock for the science lab',
          department: 'teaching',
          requestedBy: staff[0].name,
          requestedById: String(staff[0]._id),
          requestedOn: iso(addDays(today, -2)),
          neededBy: iso(addDays(today, 7)),
          priority: 'normal',
          status: 'pending',
        },
      },
      { upsert: true },
    );

    await StockMismatchModel.updateOne(
      { schoolId, itemId: String(items[0]._id), countedAt: iso(addDays(today, -6)) },
      {
        $set: {
          schoolId,
          countedAt: iso(addDays(today, -6)),
          itemId: String(items[0]._id),
          itemName: items[0].name,
          category: items[0].category,
          systemStock: (items[0].currentStock ?? 0) + 3,
          physicalCount: items[0].currentStock ?? 0,
          difference: -3,
          countedBy: 'Store Keeper',
          status: 'open',
          remarks: 'Three units unaccounted for at the monthly count.',
        },
      },
      { upsert: true },
    );
  }
  logger.info(`Inventory: ${String(invRows)} purchases + movements, 1 issue, 1 request, 1 mismatch`);

  // ── Certificates ──────────────────────────────────────────────────────
  let certs = 0;
  for (const s of students.slice(0, 6)) {
    const type = pick(`ct:${String(s._id)}`, ['bonafide', 'character', 'study'] as const);
    certs += 1;
    await CertificateModel.updateOne(
      { schoolId, studentId: String(s._id), type },
      {
        $set: {
          schoolId,
          type,
          studentId: String(s._id),
          studentName: s.name,
          classLabel: `${s.className ?? ''}-${s.section ?? ''}`,
          certificateNumber: `CERT-${String(year)}-${String(certs).padStart(4, '0')}`,
          generatedBy: 'School Admin',
          details: { purpose: 'Requested by parent', issuedOn: iso(addDays(today, -certs * 3)) },
        },
      },
      { upsert: true },
    );
  }
  logger.info(`Certificates: ${String(certs)} issued`);

  // ── Holidays ──────────────────────────────────────────────────────────
  const HOLIDAYS = [
    { name: 'Independence Day', month: 7, day: 15, type: 'national' },
    { name: 'Janmashtami', month: 7, day: 26, type: 'festival' },
    { name: 'Gandhi Jayanti', month: 9, day: 2, type: 'national' },
    { name: 'Dussehra Break', month: 9, day: 20, type: 'festival', span: 3 },
    { name: 'Diwali Break', month: 10, day: 8, type: 'festival', span: 5 },
  ];
  for (const h of HOLIDAYS) {
    const start = new Date(year, h.month, h.day);
    await HolidayModel.updateOne(
      { schoolId, name: h.name, startDate: iso(start) },
      {
        $set: {
          schoolId,
          name: h.name,
          startDate: iso(start),
          endDate: iso(addDays(start, (h.span ?? 1) - 1)),
          type: h.type,
          applicability: 'all',
          recurring: false,
        },
      },
      { upsert: true },
    );
  }
  logger.info(`Holidays: ${String(HOLIDAYS.length)}`);

  // ── Gate: pickups and visitors ────────────────────────────────────────
  let gate = 0;
  for (const s of students.slice(0, 10)) {
    const day = iso(addDays(today, -between(`gp:${String(s._id)}`, 0, 6)));
    gate += 1;
    await PickupModel.updateOne(
      { schoolId, studentId: String(s._id), inTime: `${day}T13:40:00.000Z` },
      {
        $set: {
          schoolId,
          studentId: String(s._id),
          studentName: s.name,
          className: s.className,
          section: s.section,
          admissionNumber: s.admissionNumber,
          pickupBy: s.parents?.fatherName ?? 'Parent',
          relation: 'father',
          mobile: s.parents?.fatherMobile ?? s.mobile,
          reason: 'regular_dispersal',
          verificationMethod: 'photo_match',
          inTime: `${day}T13:40:00.000Z`,
          outTime: `${day}T13:55:00.000Z`,
          approvedBy: 'Gate Manager',
          status: 'passed_out',
        },
      },
      { upsert: true },
    );
  }

  const VISITORS = [
    { name: 'Ramesh Gupta', purpose: 'Parent meeting', whomToMeet: 'Class Teacher' },
    { name: 'Sunita Devi', purpose: 'Fee enquiry', whomToMeet: 'Accountant' },
    { name: 'Alok Tiwari', purpose: 'Vendor delivery', whomToMeet: 'Store Keeper' },
    { name: 'Kavita Singh', purpose: 'Admission enquiry', whomToMeet: 'Receptionist' },
  ];
  for (let i = 0; i < VISITORS.length; i += 1) {
    const v = VISITORS[i]!;
    const day = iso(addDays(today, -i));
    await VisitorModel.updateOne(
      { schoolId, name: v.name, inTime: `${day}T10:${String(15 + i * 10).padStart(2, '0')}:00.000Z` },
      {
        $set: {
          schoolId,
          name: v.name,
          mobile: `9${String(between(`v:${v.name}`, 100000000, 999999999))}`,
          purpose: v.purpose,
          whomToMeet: v.whomToMeet,
          inTime: `${day}T10:${String(15 + i * 10).padStart(2, '0')}:00.000Z`,
          outTime: i === 0 ? undefined : `${day}T11:05:00.000Z`,
          status: i === 0 ? 'inside' : 'checked_out',
        },
      },
      { upsert: true },
    );
  }
  logger.info(`Gate: ${String(gate)} pickups, ${String(VISITORS.length)} visitors`);

  logger.info('Roster demo data complete. Run `npm run seed:demo` to give new students their history.');
  await disconnectDb();
}

/** A class with no fee structure rows cannot be billed. */
function breakDownEmpty(rows: { amount: number }[]): boolean {
  return rows.length === 0;
}

main().catch((err: unknown) => {
  logger.error('Roster demo data failed', err);
  process.exit(1);
});
