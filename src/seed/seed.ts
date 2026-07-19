import bcrypt from 'bcryptjs';

import { ClassModel, SectionModel, SessionModel } from '../modules/academics/academics.models';
import { AttendanceModel } from '../modules/attendance/attendance.models';
import { ExamMarkModel, ExamModel } from '../modules/exams/exams.models';
import { FeeHeadModel, FeeStructureModel } from '../modules/fee/fee.models';
import { AppliedFineModel, ConcessionModel, FineRuleModel } from '../modules/fee/fee-extras.models';
import { BankAccountModel, BankDepositModel, IncomeModel, VendorPaymentModel } from '../modules/finance/finance.models';
import { BookCopyModel, BookModel, LibraryMemberModel } from '../modules/library/library.models';
import { BuildingModel, HostelStudentModel, RoomModel } from '../modules/hostel/hostel.models';
import { DriverModel, RouteModel, StudentTransportModel, VehicleModel } from '../modules/transport/transport.models';
import { AssetModel, InventoryItemModel, VendorModel } from '../modules/inventory/inventory.models';
import { StaffModel } from '../modules/staff/staff.models';
import {
  SalaryAdvanceModel,
  StaffActivityModel,
  StaffDocumentModel,
  StaffLeaveApplicationModel,
} from '../modules/staff/staff-hr.models';
import { AnnouncementModel, CircularModel, NotificationModel } from '../modules/communication/communication.models';
import { AppointmentModel, CallLogModel } from '../modules/reception/reception.models';
import { StaffLeaveModel, StudentLeaveModel } from '../modules/coordinator/coordinator.models';
import { TeacherPassModel, VisitorModel } from '../modules/gate-manager/gate-manager.models';
import { ReceiptModel } from '../modules/fee/fee.models';
import { ReadjustmentModel, WaiveOffModel } from '../modules/fee/fee-adjust.models';
import { RefundRequestModel } from '../modules/fee/fee-refunds.models';
import { ParentComplaintModel } from '../modules/parent/parent.models';
import { AuditLogModel, SubscriptionModel, TicketModel } from '../modules/superadmin/superadmin.models';
import {
  TeacherAssignmentModel,
  TeacherClassModel,
  TeacherHomeworkModel,
  TeacherLeaveModel,
} from '../modules/teacher/teacher.models';
import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { SchoolModel } from '../modules/school/school.model';
import { StudentModel } from '../modules/students/student.model';
import type { UserRole } from '../modules/user/roles';
import { UserModel } from '../modules/user/user.model';

const DEMO_PASSWORD = 'demo1234';

const ALL_MODULES = [
  'fee',
  'onlinePayment',
  'transport',
  'hostel',
  'library',
  'inventory',
  'timetable',
  'exam',
  'attendance',
  'communication',
  'gate',
  'payroll',
];

interface SeedUser {
  name: string;
  username: string;
  email: string;
  mobile?: string;
  role: UserRole;
  password: string;
  tenant: boolean;
}

/** Mirrors the frontend DEMO_CREDENTIALS + the mobile parent/student/driver. */
const DEMO_USERS: SeedUser[] = [
  { name: 'Super Admin', username: 'superadmin', email: 'superadmin@msc.test', role: 'super_admin', password: DEMO_PASSWORD, tenant: false },
  { name: 'Support Engineer', username: 'support', email: 'support@msc.test', role: 'support_engineer', password: DEMO_PASSWORD, tenant: false },
  { name: 'School Admin', username: 'schooladmin', email: 'schooladmin@msc.test', role: 'school_admin', password: DEMO_PASSWORD, tenant: true },
  { name: 'Principal', username: 'principal', email: 'principal@msc.test', role: 'principal', password: DEMO_PASSWORD, tenant: true },
  { name: 'Coordinator', username: 'coordinator', email: 'coordinator@msc.test', role: 'coordinator', password: DEMO_PASSWORD, tenant: true },
  { name: 'Accountant', username: 'accountant', email: 'accountant@msc.test', role: 'accountant', password: DEMO_PASSWORD, tenant: true },
  { name: 'Teacher', username: 'teacher', email: 'teacher@msc.test', role: 'teacher', password: DEMO_PASSWORD, tenant: true },
  { name: 'Receptionist', username: 'receptionist', email: 'receptionist@msc.test', role: 'receptionist', password: DEMO_PASSWORD, tenant: true },
  { name: 'Gate Manager', username: 'amingatemanager@gmail.com', email: 'amingatemanager@gmail.com', role: 'gate_manager', password: 'Gatemanager@123', tenant: true },
  { name: 'Parent Demo', username: 'parent', email: 'parent@msc.test', mobile: '9990000001', role: 'parent', password: DEMO_PASSWORD, tenant: true },
  { name: 'Student Demo', username: 'student', email: 'student@msc.test', mobile: '9990000002', role: 'student', password: DEMO_PASSWORD, tenant: true },
  { name: 'Driver Demo', username: 'driver', email: 'driver@msc.test', role: 'driver', password: DEMO_PASSWORD, tenant: true },
];

/** A few extra tenants so the super-admin list/dashboard have data. */
const EXTRA_SCHOOLS = [
  { code: 'GVN', name: 'Green Valley National School', city: 'Ludhiana', state: 'Punjab', status: 'active', plan: 'yearly', amountPaid: 44999 },
  { code: 'SPS', name: 'Sunrise Public School', city: 'Amritsar', state: 'Punjab', status: 'trial', plan: 'monthly', amountPaid: 0 },
  { code: 'HRT', name: 'Heritage International', city: 'Chandigarh', state: 'Chandigarh', status: 'expired', plan: 'quarterly', amountPaid: 13499 },
] as const;

export async function seedDemo() {
  const school = await SchoolModel.findOneAndUpdate(
    { code: 'MSC' },
    {
      name: 'MySmartCampus Academy',
      code: 'MSC',
      city: 'Patiala',
      state: 'Punjab',
      status: 'active',
      plan: 'yearly',
      expiryDate: '2027-03-31',
      active: true,
      modules: ALL_MODULES,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (!school) throw new Error('Failed to seed demo school');

  for (const s of EXTRA_SCHOOLS) {
    await SchoolModel.findOneAndUpdate(
      { code: s.code },
      {
        name: s.name,
        code: s.code,
        city: s.city,
        state: s.state,
        status: s.status,
        plan: s.plan,
        expiryDate: '2026-12-31',
        active: s.status === 'active' || s.status === 'trial',
        subscription: {
          id: `sub_${s.code.toLowerCase()}`,
          plan: s.plan,
          endDate: '2026-12-31',
          amountPaid: s.amountPaid,
          status: 'active',
          addedBy: 'Seed',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const users = [];
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const doc = await UserModel.findOneAndUpdate(
      { username: u.username },
      {
        name: u.name,
        username: u.username,
        email: u.email,
        mobile: u.mobile,
        role: u.role,
        passwordHash,
        schoolId: u.tenant ? school._id : undefined,
        schoolName: u.tenant ? school.name : undefined,
        active: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    users.push(doc);
  }

  // Academic master data for MSC: an active session, classes + sections.
  await SessionModel.findOneAndUpdate(
    { schoolId: school._id, name: '2025-26' },
    {
      schoolId: school._id,
      name: '2025-26',
      startDate: '2025-04-01',
      endDate: '2026-03-31',
      status: 'active',
      createdBy: 'System',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const CLASSES = [
    { name: 'Nursery', order: 1 },
    { name: 'LKG', order: 2 },
    { name: 'UKG', order: 3 },
    { name: 'Class 1', order: 4 },
    { name: 'Class 2', order: 5 },
  ];
  for (const c of CLASSES) {
    const cls = await ClassModel.findOneAndUpdate(
      { schoolId: school._id, name: c.name },
      { schoolId: school._id, name: c.name, order: c.order },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!cls) continue;
    for (const secName of ['A', 'B']) {
      await SectionModel.findOneAndUpdate(
        { schoolId: school._id, classId: cls._id, name: secName },
        { schoolId: school._id, classId: cls._id, name: secName, maxCapacity: 40 },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
  }

  // Students distributed across classes/sections (3 per class).
  const NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Ananya', 'Diya', 'Ishaan', 'Kabir', 'Mehar', 'Naina', 'Reyansh', 'Sara', 'Vihaan', 'Kiara', 'Arjun', 'Myra'];
  const FEE = ['paid', 'partial', 'pending', 'advance'] as const;
  const seededClasses = await ClassModel.find({ schoolId: school._id }).sort({ order: 1 }).lean();
  let n = 1001;
  for (const cls of seededClasses) {
    const secs = await SectionModel.find({ schoolId: school._id, classId: cls._id }).lean();
    for (let i = 0; i < 3; i += 1) {
      const sec = secs[i % Math.max(1, secs.length)];
      const admissionNumber = `ADM${n}`;
      const first = NAMES[n % NAMES.length];
      const mobile = `98765${String(10000 + n).slice(-5)}`;
      await StudentModel.findOneAndUpdate(
        { schoolId: school._id, admissionNumber },
        {
          schoolId: school._id,
          admissionNumber,
          rollNumber: String(i + 1),
          name: `${first} Kumar`,
          fatherName: `Mr. ${first} Kumar Sr.`,
          classId: cls._id,
          className: cls.name,
          sectionId: sec?._id,
          section: sec?.name ?? 'A',
          classKey: cls.name,
          admissionType: i % 2 === 0 ? 'new' : 'old',
          admittedAt: new Date('2025-04-05'),
          feeStatus: FEE[n % FEE.length],
          profileStatus: 'active',
          mobile,
          sessionLabel: '2025-26',
          parents: { fatherName: `Mr. ${first} Kumar Sr.`, fatherMobile: mobile },
          currentAddress: { line1: '12 Main St', city: 'Patiala', state: 'Punjab', pinCode: '147001' },
          permanentAddress: { line1: '12 Main St', city: 'Patiala', state: 'Punjab', pinCode: '147001' },
          permanentSameAsCurrent: true,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      n += 1;
    }
  }

  // Attendance for a few weekdays in April 2025 (mostly present, some absent/leave).
  const allStudents = await StudentModel.find({ schoolId: school._id }).lean();
  const ATT_DATES = ['2025-04-07', '2025-04-08', '2025-04-09'];
  for (const date of ATT_DATES) {
    await Promise.all(
      allStudents.map((s, i) => {
        const status = i % 10 === 0 ? 'absent' : i % 7 === 0 ? 'leave' : 'present';
        return AttendanceModel.updateOne(
          { schoolId: school._id, studentId: s._id, date },
          {
            $set: {
              schoolId: school._id,
              studentId: s._id,
              date,
              status,
              className: s.className,
              section: s.section,
              markedBy: 'Seed',
            },
          },
          { upsert: true },
        );
      }),
    );
  }

  // A published Mid-Term exam with marks for Class 1 (2 subjects).
  const pattern = {
    assessmentType: 'theory_practical',
    maxTheory: 80,
    maxPractical: 20,
    maxInternal: 0,
    passingTheory: 27,
    passingPractical: 7,
    gradeSystem: 'percentage',
    gradeRanges: [],
  };
  const patternByClass: Record<string, typeof pattern> = {};
  for (const c of seededClasses) patternByClass[c.name] = pattern;

  const exam = await ExamModel.findOneAndUpdate(
    { schoolId: school._id, name: 'Mid Term 2025' },
    {
      schoolId: school._id,
      name: 'Mid Term 2025',
      type: 'mid_term',
      session: '2025-26',
      classes: seededClasses.map((c) => c.name),
      startDate: '2025-09-01',
      endDate: '2025-09-10',
      resultDate: '2025-09-20',
      status: 'published',
      published: true,
      patternByClass,
      publishedResults: ['Class 1'],
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (exam) {
    const class1 = allStudents.filter((s) => s.className === 'Class 1');
    const SUBJECTS = ['math', 'english'];
    for (let idx = 0; idx < class1.length; idx += 1) {
      const s = class1[idx];
      for (const subj of SUBJECTS) {
        await ExamMarkModel.updateOne(
          { examId: exam._id, subjectId: subj, studentId: s._id },
          {
            $set: {
              schoolId: school._id,
              examId: exam._id,
              classKey: 'Class 1',
              subjectId: subj,
              studentId: s._id,
              theory: 55 + idx * 5,
              practical: 15,
              internal: 0,
              isAbsent: false,
              submitted: true,
            },
          },
          { upsert: true },
        );
      }
    }
  }

  // Fee heads + structure for the active session.
  const FEE_HEADS = [
    { name: 'Tuition Fee', type: 'tuition', order: 1, freq: 'monthly', base: 1000 },
    { name: 'Exam Fee', type: 'exam', order: 2, freq: 'yearly', base: 2000 },
    { name: 'Transport Fee', type: 'transport', order: 3, freq: 'monthly', base: 800 },
  ];
  for (const h of FEE_HEADS) {
    const head = await FeeHeadModel.findOneAndUpdate(
      { schoolId: school._id, name: h.name },
      { schoolId: school._id, name: h.name, type: h.type, order: h.order, isMandatory: true, isRefundable: false },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!head) continue;
    const amounts: Record<string, number> = {};
    seededClasses.forEach((c, i) => {
      amounts[c.name] = h.base + i * 100;
    });
    await FeeStructureModel.updateOne(
      { schoolId: school._id, session: '2025-26', feeHeadId: String(head._id) },
      { $set: { schoolId: school._id, session: '2025-26', feeHeadId: String(head._id), frequency: h.freq, amounts } },
      { upsert: true },
    );
  }

  // Library: books (with copies) + members from students.
  const LIB_BOOKS = [
    { title: 'Wings of Fire', authors: ['A.P.J. Abdul Kalam'], isbn: '9788173711466', category: 'non_fiction', totalCopies: 3 },
    { title: 'Panchatantra', authors: ['Vishnu Sharma'], isbn: '9788172341623', category: 'fiction', totalCopies: 2 },
    { title: 'NCERT Science VI', authors: ['NCERT'], isbn: '9788174504968', category: 'science', totalCopies: 4 },
  ];
  for (const b of LIB_BOOKS) {
    const book = await BookModel.findOneAndUpdate(
      { schoolId: school._id, isbn: b.isbn },
      {
        schoolId: school._id,
        title: b.title,
        authors: b.authors,
        isbn: b.isbn,
        category: b.category,
        language: 'en',
        publicationYear: 2015,
        totalCopies: b.totalCopies,
        availableCopies: b.totalCopies,
        issuedCopies: 0,
        lostCopies: 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!book) continue;
    const existing = await BookCopyModel.countDocuments({ schoolId: school._id, bookId: book._id });
    if (existing === 0) {
      await BookCopyModel.insertMany(
        Array.from({ length: b.totalCopies }, (_, i) => ({
          schoolId: school._id,
          bookId: book._id,
          copyNumber: i + 1,
          barcode: `${b.isbn}-${String(i + 1).padStart(3, '0')}`,
          condition: 'good',
          status: 'available',
        })),
      );
    }
  }
  for (const s of allStudents.slice(0, 5)) {
    await LibraryMemberModel.findOneAndUpdate(
      { schoolId: school._id, name: s.name, type: 'student' },
      {
        schoolId: school._id,
        type: 'student',
        name: s.name,
        classOrDesignation: `${s.className}-${s.section}`,
        memberSince: '2025-04-01',
        maxBooksAllowed: 3,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Hostel: a building with 2 rooms; allocate the first student.
  const building = await BuildingModel.findOneAndUpdate(
    { schoolId: school._id, name: 'Boys Hostel A' },
    { schoolId: school._id, name: 'Boys Hostel A', type: 'boys', floors: 2, wardenName: 'Mr. Warden', status: 'active' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (building && (await RoomModel.countDocuments({ schoolId: school._id, buildingId: building._id })) === 0) {
    for (const rn of ['101', '102']) {
      await RoomModel.create({
        schoolId: school._id,
        buildingId: building._id,
        buildingName: building.name,
        floorNumber: 1,
        roomNumber: rn,
        roomType: 'double',
        totalBeds: 2,
        monthlyCharge: 3000,
        beds: [
          { bedNumber: '1', status: 'empty' },
          { bedNumber: '2', status: 'empty' },
        ],
      });
    }
    const room = await RoomModel.findOne({ schoolId: school._id, buildingId: building._id, roomNumber: '101' });
    const stu = allStudents[0];
    if (room && stu) {
      const bed = room.beds[0];
      await HostelStudentModel.create({
        schoolId: school._id,
        studentId: String(stu._id),
        studentName: stu.name,
        className: stu.className,
        buildingId: String(building._id),
        buildingName: building.name,
        roomId: String(room._id),
        roomNumber: '101',
        bedId: String(bed._id),
        bedNumber: bed.bedNumber,
        allocatedFrom: '2025-04-10',
        monthlyFee: 3000,
        messIncluded: true,
        messMonthlyCharge: 2000,
        paymentStatus: 'pending',
        status: 'allocated',
      });
      bed.status = 'occupied';
      bed.studentId = String(stu._id);
      bed.studentName = stu.name;
      bed.studentClass = stu.className;
      bed.sinceDate = '2025-04-10';
      room.status = 'partial';
      await room.save();
    }
  }

  // Transport: driver + vehicle + route + one student assignment.
  const driver = await DriverModel.findOneAndUpdate(
    { schoolId: school._id, licenseNumber: 'DL-2020-001' },
    { schoolId: school._id, name: 'Rajesh Singh', mobile: '9876500001', licenseNumber: 'DL-2020-001', licenseType: 'hmv', status: 'active' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const vehicle = await VehicleModel.findOneAndUpdate(
    { schoolId: school._id, registrationNumber: 'PB-11-AB-1234' },
    { schoolId: school._id, registrationNumber: 'PB-11-AB-1234', vehicleType: 'bus', seatingCapacity: 40, status: 'active', driverName: 'Rajesh Singh', driverMobile: '9876500001' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const route = await RouteModel.findOneAndUpdate(
    { schoolId: school._id, routeCode: 'R1' },
    {
      schoolId: school._id,
      routeName: 'North Route',
      routeCode: 'R1',
      fromLocation: 'School',
      toLocation: 'Model Town',
      monthlyFee: 800,
      status: 'active',
      assignedVehicleId: vehicle ? String(vehicle._id) : undefined,
      assignedVehicleNumber: 'PB-11-AB-1234',
      assignedDriverId: driver ? String(driver._id) : undefined,
      assignedDriverName: 'Rajesh Singh',
      stops: [{ stopOrder: 1, stopName: 'Model Town', pickupTime: '07:30', dropTime: '14:30' }],
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const transStudent = allStudents[0];
  if (transStudent) {
    await StudentTransportModel.findOneAndUpdate(
      { schoolId: school._id, studentId: String(transStudent._id) },
      {
        schoolId: school._id,
        studentId: String(transStudent._id),
        studentName: transStudent.name,
        className: transStudent.className,
        routeId: route ? String(route._id) : undefined,
        routeName: 'North Route',
        stopName: 'Model Town',
        pickupPoint: 'Model Town',
        dropPoint: 'Model Town',
        monthlyFee: 800,
        paymentStatus: 'pending',
        busPassNumber: 'BP-001',
        effectiveFrom: '2025-04-01',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Inventory: items (varied stock), a vendor, an asset.
  const INV_ITEMS = [
    { name: 'A4 Paper Ream', category: 'stationery', unit: 'ream', currentStock: 50, minStockLevel: 10, unitPrice: 250 },
    { name: 'Whiteboard Marker', category: 'stationery', unit: 'piece', currentStock: 8, minStockLevel: 20, unitPrice: 40 },
    { name: 'Chalk Box', category: 'stationery', unit: 'box', currentStock: 0, minStockLevel: 5, unitPrice: 30 },
  ];
  for (const it of INV_ITEMS) {
    const status = it.currentStock <= 0 ? 'out_of_stock' : it.currentStock <= it.minStockLevel ? 'low_stock' : 'in_stock';
    await InventoryItemModel.findOneAndUpdate(
      { schoolId: school._id, name: it.name },
      { schoolId: school._id, ...it, maxStockLevel: 100, location: 'Store Room', status },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  await VendorModel.findOneAndUpdate(
    { schoolId: school._id, name: 'Sharma Stationers' },
    { schoolId: school._id, name: 'Sharma Stationers', contactPerson: 'Mr. Sharma', mobile: '9876511111', gstNumber: 'GST123' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await AssetModel.findOneAndUpdate(
    { schoolId: school._id, assetCode: 'AST-001' },
    { schoolId: school._id, name: 'Projector', assetCode: 'AST-001', category: 'electronics', purchasePrice: 45000, currentValue: 30000, location: 'Lab 1', condition: 'good' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Staff/HR: teaching + non-teaching employees.
  const STAFF = [
    { name: 'Anjali Sharma', designation: 'principal', designationLabel: 'Principal', department: 'administration', departmentLabel: 'Administration', category: 'non_teaching', mobile: '9876520001', basic: 60000, joiningDate: '2020-06-01' },
    { name: 'Rahul Verma', designation: 'teacher', designationLabel: 'TGT', department: 'teaching', departmentLabel: 'Teaching', category: 'teaching', mobile: '9876520002', basic: 35000, joiningDate: '2022-04-01' },
    { name: 'Priya Nair', designation: 'teacher', designationLabel: 'PRT', department: 'teaching', departmentLabel: 'Teaching', category: 'teaching', mobile: '9876520003', basic: 30000, joiningDate: '2023-07-01' },
    { name: 'Suresh Kumar', designation: 'accountant', designationLabel: 'Accountant', department: 'accounts', departmentLabel: 'Accounts', category: 'non_teaching', mobile: '9876520004', basic: 32000, joiningDate: '2021-03-01' },
  ];
  let empN = 1;
  for (const s of STAFF) {
    const employeeId = `EMP${String(empN).padStart(4, '0')}`;
    await StaffModel.findOneAndUpdate(
      { schoolId: school._id, employeeId },
      { schoolId: school._id, ...s, employeeId, employmentType: 'full_time', status: 'active', netSalary: Math.round(s.basic * 1.37) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    empN += 1;
  }

  // Communication: circulars (1 published, 1 draft), an announcement, notifications.
  await CircularModel.findOneAndUpdate(
    { schoolId: school._id, number: 'CIR/2025/001' },
    { schoolId: school._id, number: 'CIR/2025/001', title: 'Annual Day Notice', body: 'Annual Day on 20th.', dateOfIssue: '2025-09-01', audience: ['all'], priority: 'normal', status: 'published', createdBy: 'Admin' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await CircularModel.findOneAndUpdate(
    { schoolId: school._id, number: 'CIR/2025/002' },
    { schoolId: school._id, number: 'CIR/2025/002', title: 'Fee Reminder', body: 'Pay by 15th.', dateOfIssue: '2025-09-10', audience: ['parents'], priority: 'urgent', status: 'draft', createdBy: 'Admin' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await AnnouncementModel.findOneAndUpdate(
    { schoolId: school._id, title: 'Holiday Notice' },
    { schoolId: school._id, title: 'Holiday Notice', body: 'School closed Friday.', priority: 'normal', audience: ['all'], pinned: true, postedBy: 'Admin', postedAt: '2025-09-05T10:00:00.000Z' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const NOTIFS = [
    { category: 'fee', title: 'Fee received', description: 'ADM1001 paid', read: false },
    { category: 'attendance', title: 'Absentee alert', description: '2 absent today', read: false },
    { category: 'general', title: 'System update', description: 'Maintenance done', read: true },
  ];
  for (const n of NOTIFS) {
    await NotificationModel.findOneAndUpdate(
      { schoolId: school._id, title: n.title },
      { schoolId: school._id, ...n, createdAt: '2025-09-12T09:00:00.000Z' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Fee extras: a fine rule, concessions (one needing approval), an applied fine.
  await FineRuleModel.findOneAndUpdate(
    { schoolId: school._id, name: 'Late Fee' },
    { schoolId: school._id, name: 'Late Fee', applicableAfterDays: 10, type: 'fixed', value: 100, applicableClasses: 'all', active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await ConcessionModel.findOneAndUpdate(
    { schoolId: school._id, name: 'Sibling Discount' },
    { schoolId: school._id, code: 'CON001', name: 'Sibling Discount', category: 'sibling', calcType: 'percentage', value: 10, requiresApproval: false, applicableClasses: 'all', active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await ConcessionModel.findOneAndUpdate(
    { schoolId: school._id, name: 'Staff Child' },
    { schoolId: school._id, code: 'CON002', name: 'Staff Child', category: 'staff_child', calcType: 'percentage', value: 50, requiresApproval: true, applicableClasses: 'all', active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const fineStudent = allStudents[1];
  if (fineStudent) {
    await AppliedFineModel.findOneAndUpdate(
      { schoolId: school._id, studentId: String(fineStudent._id), fineRuleName: 'Late Fee', month: 'April' },
      { schoolId: school._id, studentId: String(fineStudent._id), studentName: fineStudent.name, className: fineStudent.className, fineRuleName: 'Late Fee', month: 'April', amount: 100, appliedAt: '2025-05-01', status: 'pending' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Finance: bank accounts + a deposit, one income + one vendor payment.
  await BankAccountModel.findOneAndUpdate(
    { schoolId: school._id, accountLast4: '4521' },
    { schoolId: school._id, bankName: 'SBI', accountLabel: 'Current A/c •4521', accountLast4: '4521', branch: 'Patiala Main' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const hdfc = await BankAccountModel.findOneAndUpdate(
    { schoolId: school._id, accountLast4: '7788' },
    { schoolId: school._id, bankName: 'HDFC', accountLabel: 'Savings A/c •7788', accountLast4: '7788' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await BankDepositModel.findOneAndUpdate(
    { schoolId: school._id, slipNumber: 'SLP001' },
    { schoolId: school._id, depositDate: '2025-05-02', recipientType: 'bank', bankAccountId: hdfc ? String(hdfc._id) : undefined, bankName: 'HDFC', accountLabel: 'Savings A/c •7788', amount: 50000, slipNumber: 'SLP001', depositedBy: 'Accountant', createdAt: '2025-05-02T10:00:00.000Z' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await IncomeModel.findOneAndUpdate(
    { schoolId: school._id, reference: 'INC-SEED-1' },
    { schoolId: school._id, date: '2025-05-01', source: 'donation', description: 'Alumni donation', amount: 25000, mode: 'online', reference: 'INC-SEED-1', createdBy: 'Accountant', createdAt: '2025-05-01T09:00:00.000Z' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await VendorPaymentModel.findOneAndUpdate(
    { schoolId: school._id, reference: 'VP-SEED-1' },
    { schoolId: school._id, date: '2025-05-03', vendorName: 'Sharma Stationers', amount: 5000, mode: 'cheque', reference: 'VP-SEED-1', createdBy: 'Accountant', createdAt: '2025-05-03T11:00:00.000Z' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Reception: an appointment + a call log.
  await AppointmentModel.findOneAndUpdate(
    { schoolId: school._id, visitorName: 'Mr. Gupta', date: '2025-05-05' },
    { schoolId: school._id, visitorName: 'Mr. Gupta', visitorMobile: '9876530001', date: '2025-05-05', time: '10:00', durationMinutes: 30, purpose: 'admission', withWhom: 'Principal', status: 'scheduled', sendReminder: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await CallLogModel.findOneAndUpdate(
    { schoolId: school._id, callerName: 'Mrs. Rao', mobile: '9876530002' },
    { schoolId: school._id, loggedAt: '2025-05-04T11:00:00.000Z', direction: 'incoming', callerName: 'Mrs. Rao', mobile: '9876530002', purpose: 'fee_query', followUpRequired: true, followUpDone: false },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Coordinator: a few pending student-leave requests.
  const leaveStudents = allStudents.slice(0, 3);
  for (let i = 0; i < leaveStudents.length; i += 1) {
    const s = leaveStudents[i];
    await StudentLeaveModel.findOneAndUpdate(
      { schoolId: school._id, studentId: String(s._id), fromDate: `2025-05-1${i}` },
      {
        schoolId: school._id,
        studentId: String(s._id),
        studentName: s.name,
        className: s.className,
        fatherName: s.fatherName,
        fatherMobile: s.mobile,
        fromDate: `2025-05-1${i}`,
        toDate: `2025-05-1${i}`,
        days: 1,
        type: 'medical',
        reason: 'Fever',
        appliedOn: `2025-05-0${i + 1}T09:00:00.000Z`,
        status: 'pending',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Coordinator: staff-leave requests across the approval chain.
  const staffDocs = await StaffModel.find({ schoolId: school._id }).sort({ employeeId: 1 }).lean();
  const staffLeaves = [
    { s: staffDocs[1], type: 'casual', fromDate: '2025-05-10', toDate: '2025-05-11', days: 2, reason: 'Personal work', currentLevel: 1, status: 'pending' },
    { s: staffDocs[2], type: 'sick', fromDate: '2025-05-08', toDate: '2025-05-08', days: 1, reason: 'Fever', currentLevel: 2, status: 'pending', remarks: 'Approved by coordinator' },
    { s: staffDocs[3], type: 'earned', fromDate: '2025-04-20', toDate: '2025-04-22', days: 3, reason: 'Family function', currentLevel: 1, status: 'rejected', rejectionReason: 'Peak exam season' },
  ];
  for (const l of staffLeaves) {
    if (!l.s) continue;
    await StaffLeaveModel.findOneAndUpdate(
      { schoolId: school._id, staffId: String(l.s._id), fromDate: l.fromDate },
      {
        schoolId: school._id,
        staffId: String(l.s._id),
        staffName: l.s.name,
        designation: l.s.designationLabel ?? l.s.designation,
        department: l.s.departmentLabel ?? l.s.department,
        type: l.type,
        fromDate: l.fromDate,
        toDate: l.toDate,
        days: l.days,
        reason: l.reason,
        appliedOn: `2025-05-0${staffLeaves.indexOf(l) + 1}T09:00:00.000Z`,
        currentLevel: l.currentLevel,
        status: l.status,
        remarks: l.remarks,
        rejectionReason: l.rejectionReason,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Staff HR: a pending leave application, a document, an activity entry, an advance.
  const hrStaff = staffDocs[1];
  if (hrStaff) {
    const hid = String(hrStaff._id);
    await StaffLeaveApplicationModel.findOneAndUpdate(
      { schoolId: school._id, staffId: hid, fromDate: '2025-06-01' },
      { schoolId: school._id, staffId: hid, type: 'casual', fromDate: '2025-06-01', toDate: '2025-06-02', days: 2, reason: 'Personal', appliedOn: '2025-05-20T09:00:00.000Z', status: 'pending', currentLevel: 1, history: [] },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await StaffDocumentModel.findOneAndUpdate(
      { schoolId: school._id, staffId: hid, fileName: 'aadhaar.pdf' },
      { schoolId: school._id, staffId: hid, category: 'id_proof', fileName: 'aadhaar.pdf', sizeBytes: 120000, uploadedAt: '2025-04-01T09:00:00.000Z', uploadedBy: 'Admin' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await StaffActivityModel.findOneAndUpdate(
      { schoolId: school._id, staffId: hid, action: 'Profile created' },
      { schoolId: school._id, staffId: hid, timestamp: '2025-04-01T09:00:00.000Z', action: 'Profile created', performedBy: 'Admin', module: 'staff' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await SalaryAdvanceModel.findOneAndUpdate(
      { schoolId: school._id, staffId: hid, requestDate: '2025-05-15' },
      { schoolId: school._id, staffId: hid, staffName: hrStaff.name, amountRequested: 20000, reason: 'Medical', requestDate: '2025-05-15', repaymentMonths: 4, monthlyRecovery: 5000, status: 'pending' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Gate manager: one visitor inside, one checked out, one open teacher pass. Dated "today"
  // so the day-scoped dashboard counters are deterministic within a run.
  const todayIso = new Date().toISOString();
  const gateVisitors = [
    { name: 'Mr. Sharma', mobile: '9876500001', purpose: 'Parent meeting', whomToMeet: 'Class Teacher', takingStudentHome: false, passNumber: 'V-1045', outTime: undefined },
    { name: 'Courier Boy', mobile: '9876500002', purpose: 'Delivery', whomToMeet: 'Office', takingStudentHome: false, passNumber: 'V-1046', outTime: todayIso },
  ];
  for (const v of gateVisitors) {
    await VisitorModel.findOneAndUpdate(
      { schoolId: school._id, passNumber: v.passNumber },
      { schoolId: school._id, inTime: todayIso, ...v },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  await TeacherPassModel.findOneAndUpdate(
    { schoolId: school._id, teacherName: 'Teacher', outTime: todayIso },
    { schoolId: school._id, teacherName: 'Teacher', duration: '2_hours', reason: 'Bank work', outTime: todayIso, issuedBy: 'Gate Manager' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Parent portal: link the demo parent (mobile 9990000001) to two children via
  // motherMobile (unused elsewhere, so no existing assertion collides), seed a
  // paid receipt for the first child + one open complaint.
  const parentMobile = '9990000001';
  const parentKids = allStudents.slice(0, 2);
  for (const s of parentKids) {
    await StudentModel.updateOne(
      { _id: s._id },
      { $set: { 'parents.motherMobile': parentMobile, 'parents.motherName': 'Parent Demo' } },
    );
  }
  const kid = parentKids[0];
  if (kid) {
    await ReceiptModel.findOneAndUpdate(
      { schoolId: school._id, receiptNumber: 'RCPT-PARENT-001' },
      {
        schoolId: school._id,
        receiptNumber: 'RCPT-PARENT-001',
        studentId: kid._id,
        studentName: kid.name,
        className: kid.className,
        section: kid.section,
        monthsCovered: ['Apr 2025', 'May 2025'],
        feeHeads: [{ name: 'Tuition', amount: 5000 }],
        amount: 5000,
        paymentMode: 'cash',
        paymentDate: '2025-05-10',
        status: 'active',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await ParentComplaintModel.findOneAndUpdate(
      { schoolId: school._id, studentId: String(kid._id), subject: 'Bus running late' },
      {
        schoolId: school._id,
        studentId: String(kid._id),
        subject: 'Bus running late',
        category: 'transport',
        description: 'The morning bus has been 20 minutes late all week.',
        submittedAt: '2025-05-02T08:00:00.000Z',
        status: 'in_review',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Teacher portal: assign the demo teacher to two classes + seed homework,
  // an assignment and leave history.
  const teacher = await UserModel.findOne({ schoolId: school._id, role: 'teacher' }).lean();
  if (teacher) {
    const tid = String(teacher._id);
    const teacherClasses = [
      { className: 'Class 1', section: 'A', subjects: ['Mathematics', 'Science'], periodsPerWeek: 8 },
      { className: 'Class 2', section: 'A', subjects: ['English'], periodsPerWeek: 5 },
    ];
    for (const tc of teacherClasses) {
      await TeacherClassModel.findOneAndUpdate(
        { schoolId: school._id, teacherUserId: tid, className: tc.className, section: tc.section },
        { schoolId: school._id, teacherUserId: tid, ...tc },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    await TeacherHomeworkModel.findOneAndUpdate(
      { schoolId: school._id, teacherUserId: tid, title: 'Algebra worksheet' },
      {
        schoolId: school._id,
        teacherUserId: tid,
        classKey: 'Class 1-A',
        subject: 'Mathematics',
        title: 'Algebra worksheet',
        description: 'Complete exercises 1-10.',
        assignedDate: '2025-05-05',
        dueDate: '2025-05-07',
        homeworkType: 'daily',
        submissions: 0,
        createdBy: 'Teacher',
        createdById: tid,
        editHistory: [],
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await TeacherAssignmentModel.findOneAndUpdate(
      { schoolId: school._id, teacherUserId: tid, title: 'Science project' },
      {
        schoolId: school._id,
        teacherUserId: tid,
        classKey: 'Class 1-A',
        subject: 'Science',
        title: 'Science project',
        description: 'Build a model volcano.',
        instructions: 'Submit a photo + short write-up.',
        maxMarks: 20,
        assignedDate: '2025-05-04',
        dueDate: '2025-05-14',
        submissionType: 'both',
        status: 'active',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const teacherLeaves = [
      { type: 'casual', fromDate: '2025-04-10', toDate: '2025-04-11', days: 2, reason: 'Personal work', status: 'approved', referenceNumber: 'LV-0001', decidedBy: 'Principal' },
      { type: 'sick', fromDate: '2025-05-02', toDate: '2025-05-02', days: 1, reason: 'Fever', status: 'pending', referenceNumber: 'LV-0002' },
    ];
    for (const lv of teacherLeaves) {
      await TeacherLeaveModel.findOneAndUpdate(
        { schoolId: school._id, teacherUserId: tid, referenceNumber: lv.referenceNumber },
        { schoolId: school._id, teacherUserId: tid, appliedOn: '2025-04-01T09:00:00.000Z', ...lv },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
  }

  // Fee adjustments: one readjustment audit row + two waive-offs (pending + applied).
  const woStudent = allStudents[0];
  if (woStudent) {
    await ReadjustmentModel.findOneAndUpdate(
      { schoolId: school._id, reason: 'Carried-forward correction' },
      { schoolId: school._id, type: 'previous_fee', date: '2025-05-01T09:00:00.000Z', studentName: woStudent.name, className: woStudent.className, oldValue: '5000', newValue: '4500', difference: '-500', reason: 'Carried-forward correction', performedBy: 'Accountant', ipAddress: '10.0.0.5' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await WaiveOffModel.findOneAndUpdate(
      { schoolId: school._id, studentId: String(woStudent._id), reasonCode: 'financial_hardship' },
      { schoolId: school._id, studentId: String(woStudent._id), studentName: woStudent.name, className: woStudent.className, type: 'partial', heads: [], amount: 1500, reasonCode: 'financial_hardship', reason: 'Family hardship', requestedBy: 'Accountant', requestedAt: '2025-05-02T09:00:00.000Z', status: 'pending_approval', ipAddress: '10.0.0.5' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await WaiveOffModel.findOneAndUpdate(
      { schoolId: school._id, studentId: String(woStudent._id), reasonCode: 'staff_ward' },
      { schoolId: school._id, studentId: String(woStudent._id), studentName: woStudent.name, className: woStudent.className, type: 'full', heads: [], amount: 3000, reasonCode: 'staff_ward', reason: 'Staff child', requestedBy: 'Principal', requestedAt: '2025-04-15T09:00:00.000Z', status: 'applied', approvedBy: 'Principal', approvedAt: '2025-04-15T10:00:00.000Z', appliedAt: '2025-04-15T10:00:00.000Z', ipAddress: '10.0.0.2' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Fee refund requests: raised by the accountant (one per status).
  const accountant = await UserModel.findOne({ schoolId: school._id, role: 'accountant' }).lean();
  if (woStudent && accountant) {
    const accId = String(accountant._id);
    const refunds = [
      { amount: 1200, refundMode: 'bank', reason: 'Excess Q3 payment', status: 'pending_approval', requestedAt: '2025-05-18T09:00:00.000Z' },
      { amount: 800, refundMode: 'cash', reason: 'Cancelled transport', status: 'approved', requestedAt: '2025-05-10T09:00:00.000Z', approvedBy: 'Principal', approvedAt: '2025-05-12T09:00:00.000Z' },
    ];
    for (const r of refunds) {
      await RefundRequestModel.findOneAndUpdate(
        { schoolId: school._id, requestedById: accId, requestedAt: r.requestedAt },
        { schoolId: school._id, studentId: String(woStudent._id), studentName: woStudent.name, className: woStudent.className, requestedBy: 'Accountant', requestedById: accId, reference: 'REF-1', ...r },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
  }

  // Super-admin platform data: subscription history, audit logs, support tickets.
  const subs = [
    { plan: 'yearly', startDate: '2024-04-01', endDate: '2025-03-31', amountPaid: 45000, paymentMethod: 'bank_transfer', paymentReference: 'TXN-2024', createdAt: '2024-04-01T10:00:00.000Z' },
    { plan: 'yearly', startDate: '2025-04-01', endDate: '2026-03-31', amountPaid: 48000, paymentMethod: 'online', paymentReference: 'TXN-2025', createdAt: '2025-04-01T10:00:00.000Z' },
  ];
  for (const s of subs) {
    await SubscriptionModel.findOneAndUpdate(
      { schoolId: school._id, paymentReference: s.paymentReference },
      { schoolId: school._id, graceDays: 15, status: 'active', addedBy: 'Super Admin', ...s },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  const auditLogs = [
    { timestamp: '2025-05-01T09:00:00.000Z', actorName: 'School Admin', actorRole: 'school_admin', action: 'Logged in', module: 'auth', status: 'success', ipAddress: '10.0.0.2' },
    { timestamp: '2025-05-01T09:15:00.000Z', actorName: 'Accountant', actorRole: 'accountant', action: 'Collected fee', module: 'fee', status: 'success', ipAddress: '10.0.0.5' },
    { timestamp: '2025-05-01T09:30:00.000Z', actorName: 'Unknown', actorRole: 'unknown', action: 'Failed login', module: 'auth', status: 'failure', ipAddress: '203.0.113.9' },
  ];
  for (const a of auditLogs) {
    await AuditLogModel.findOneAndUpdate(
      { schoolId: school._id, timestamp: a.timestamp },
      { schoolId: school._id, ...a },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  const tickets = [
    { subject: 'Cannot print receipt', status: 'open' },
    { subject: 'Attendance sync delay', status: 'in_progress' },
    { subject: 'New report format', status: 'testing' },
    { subject: 'Login OTP not received', status: 'resolved' },
  ];
  for (const t of tickets) {
    await TicketModel.findOneAndUpdate(
      { schoolId: school._id, subject: t.subject },
      { schoolId: school._id, ...t },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  return { school, users };
}

async function main(): Promise<void> {
  await connectDb();
  const { users } = await seedDemo();
  logger.info(`Seeded 1 school + ${users.length} demo users (password: ${DEMO_PASSWORD})`);
  await disconnectDb();
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(err);
    process.exit(1);
  });
}
