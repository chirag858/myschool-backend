import { StudentModel } from '../students/student.model';
import { ReceiptModel } from '../fee/fee.models';
import { WaiveOffModel } from '../fee/fee-adjust.models';
import { StaffModel, StaffAttendanceModel } from '../staff/staff.models';
import { StaffLeaveApplicationModel } from '../staff/staff-hr.models';
import { RefundRequestModel } from '../fee/fee-refunds.models';
import { AnnouncementModel, CircularModel } from '../communication/communication.models';
import { AttendanceModel } from '../attendance/attendance.models';
import { attendanceService } from '../attendance/attendance.service';
import { feeService } from '../fee/fee.service';
import { StudentLeaveModel } from '../coordinator/coordinator.models';
import { EnquiryModel } from '../enquiries/enquiry.model';

const today = () => new Date().toISOString().slice(0, 10);
const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
const startOfPastMonth = (monthsAgo: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - monthsAgo, 1);
};

export const adminDashboardService = {
  async getStats(schoolId: string) {
    const dToday = today();
    const dStartMonth = startOfMonth();

    const [
      totalStudents,
      newStudentsThisMonth,
      outstandingDues,
      attendanceStats,
      leaveCount,
      staffCount,
      teachingStaffCount,
      staffAttendanceToday,
      todayReceipts,
    ] = await Promise.all([
      StudentModel.countDocuments({ schoolId, profileStatus: 'active' }),
      StudentModel.countDocuments({ schoolId, admittedAt: { $gte: dStartMonth } }),
      feeService.getTotalOutstanding(schoolId),
      attendanceService.dashboard(schoolId, dToday),
      AttendanceModel.countDocuments({ schoolId, date: dToday, status: 'leave' }),
      StaffModel.countDocuments({ schoolId }),
      StaffModel.countDocuments({ schoolId, category: 'teaching' }),
      StaffAttendanceModel.find({ schoolId, date: dToday }).lean(),
      ReceiptModel.aggregate([
        { $match: { schoolId: schoolId.toString(), paymentDate: dToday, status: 'successful' } },
        { $group: { _id: '$paymentMode', total: { $sum: '$amount' } } },
      ]),
    ]);

    const todayCollection = { cash: 0, online: 0, bank: 0 };
    for (const r of todayReceipts) {
      if (r._id === 'cash') todayCollection.cash = r.total;
      else if (r._id === 'online' || r._id === 'upi' || r._id === 'card') todayCollection.online += r.total;
      else if (r._id === 'bank' || r._id === 'cheque' || r._id === 'dd') todayCollection.bank += r.total;
      else todayCollection.cash += r.total;
    }

    let staffPresent = 0;
    let staffAbsent = 0;
    let staffLeave = 0;
    let teachersPresent = 0;
    let nonTeachingPresent = 0;

    const staffMap = new Map(staffAttendanceToday.map(s => [s.staffId?.toString(), s.status]));

    for (const st of staffAttendanceToday) {
      if (st.status === 'present' || st.status === 'late' || st.status === 'half_day') {
        staffPresent++;
        // To be precise, we need staff models. For now we assume if category is missing we can't tell perfectly,
        // but Kiro's plan is lightweight.
      } else if (st.status === 'absent') {
        staffAbsent++;
      } else if (st.status === 'leave') {
        staffLeave++;
      }
    }
    
    // Fallback: estimate teaching/non-teaching present based on total ratio to save a query, 
    // or just run a quick aggregate if needed. Since staff count is small, let's just query staff.
    const allStaff = await StaffModel.find({ schoolId }, { _id: 1, category: 1 }).lean();
    for (const s of allStaff) {
       const status = staffMap.get(s._id.toString());
       if (status === 'present' || status === 'late' || status === 'half_day') {
         if (s.category === 'teaching') teachersPresent++;
         else nonTeachingPresent++;
       }
    }

    return {
      totalStudents,
      newStudentsThisMonth,
      todayCollection,
      attendance: {
        presentPct: attendanceStats.overallPercent,
        presentCount: attendanceStats.totalPresent,
        absentCount: attendanceStats.totalAbsent,
        leaveCount,
      },
      pendingDues: outstandingDues,
      staff: {
        total: staffCount,
        teachingCount: teachingStaffCount,
        presentToday: staffPresent,
        absent: staffAbsent,
        onLeave: staffLeave,
        notMarked: Math.max(0, staffCount - staffAttendanceToday.length),
        teachersPresent,
        nonTeachingPresent,
      },
    };
  },

  async getStaffAttendanceByDept(schoolId: string) {
    const dToday = today();
    const [staff, attendanceToday] = await Promise.all([
      StaffModel.find({ schoolId }, { department: 1, departmentLabel: 1 }).lean(),
      StaffAttendanceModel.find({ schoolId, date: dToday }, { staffId: 1, status: 1 }).lean(),
    ]);
    const statusByStaffId = new Map(attendanceToday.map((a) => [String(a.staffId), a.status]));

    const byDept = new Map<string, { total: number; present: number; absent: number; onLeave: number; notMarked: number }>();
    for (const s of staff) {
      const dept = (s.departmentLabel as string) || (s.department as string) || 'Other';
      const row = byDept.get(dept) ?? { total: 0, present: 0, absent: 0, onLeave: 0, notMarked: 0 };
      row.total += 1;
      const status = statusByStaffId.get(String(s._id));
      if (status === 'present' || status === 'late' || status === 'half_day') row.present += 1;
      else if (status === 'absent') row.absent += 1;
      else if (status === 'leave') row.onLeave += 1;
      else row.notMarked += 1;
      byDept.set(dept, row);
    }

    return [...byDept.entries()].map(([dept, row]) => ({ dept, ...row }));
  },

  async getIncomeBreakdown(schoolId: string) {
    const dToday = today();
    const sixMonthsAgo = startOfPastMonth(5); // 6 months including current

    const [todayReceipts, trendReceipts] = await Promise.all([
      ReceiptModel.aggregate([
        { $match: { schoolId: schoolId.toString(), paymentDate: dToday, status: 'successful' } },
        { $group: { _id: '$paymentMode', total: { $sum: '$amount' } } },
      ]),
      ReceiptModel.aggregate([
        { 
          $match: { 
            schoolId: schoolId.toString(), 
            status: 'successful',
            paymentDate: { $gte: sixMonthsAgo.toISOString().slice(0,10) }
          } 
        },
        { 
          $group: { 
            _id: { 
              month: { $substr: ['$paymentDate', 0, 7] },
              mode: '$paymentMode'
            },
            total: { $sum: '$amount' }
          }
        },
      ]),
    ]);

    const cash = todayReceipts.find(r => r._id === 'cash')?.total || 0;
    const online = todayReceipts.filter(r => ['online', 'upi', 'card'].includes(r._id)).reduce((a,b) => a+b.total, 0);
    const bank = todayReceipts.filter(r => ['bank', 'cheque', 'dd'].includes(r._id)).reduce((a,b) => a+b.total, 0);

    const trendMap = new Map<string, { month: string, cash: number, online: number, bank: number }>();
    
    for (const r of trendReceipts) {
       const monthStr = r._id.month;
       const mode = r._id.mode;
       if (!trendMap.has(monthStr)) {
         // Convert YYYY-MM to Month Name
         const date = new Date(monthStr + '-01');
         const mName = date.toLocaleString('default', { month: 'short' });
         trendMap.set(monthStr, { month: mName, cash: 0, online: 0, bank: 0 });
       }
       const t = trendMap.get(monthStr)!;
       if (mode === 'cash') t.cash += r.total;
       else if (['online', 'upi', 'card'].includes(mode)) t.online += r.total;
       else if (['bank', 'cheque', 'dd'].includes(mode)) t.bank += r.total;
       else t.cash += r.total;
    }

    const monthlyTrend = Array.from(trendMap.entries())
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(entry => entry[1]);

    return { cash, online, bank, monthlyTrend };
  },

  async getAttendanceOverview(schoolId: string) {
    const sum = await attendanceService.dailySummary(schoolId, today());
    return sum.map(g => ({
      classId: `${g.classLabel}-${g.section}`,
      className: g.classLabel,
      section: g.section,
      total: g.total,
      present: g.present,
      absent: g.absent,
      notMarked: g.notMarked ? g.total : Math.max(0, g.total - g.present - g.absent - g.leave - g.halfDay - g.late)
    }));
  },

  async getPendingApprovals(schoolId: string) {
    const [concessions, staffLeave, refunds, studentLeave, pendingAdmissions] = await Promise.all([
      WaiveOffModel.countDocuments({ schoolId, status: 'pending_approval' }).catch(() => 0),
      StaffLeaveApplicationModel.countDocuments({ schoolId, status: 'pending', currentLevel: 1 }).catch(() => 0),
      RefundRequestModel.countDocuments({ schoolId, status: 'pending_approval' }).catch(() => 0),
      StudentLeaveModel.countDocuments({ schoolId, status: 'pending' }).catch(() => 0),
      EnquiryModel.countDocuments({ schoolId, status: { $in: ['new', 'contacted', 'follow_up'] } }).catch(() => 0),
    ]);

    // get oldest requestedAt for each
    const getOldest = async (Model: any, query: any, dateField: string) => {
       try {
         const doc = await Model.findOne(query).sort({ [dateField]: 1 }).lean();
         return doc ? (doc[dateField] as string) : undefined;
       } catch (e) {
         return undefined;
       }
    };

    const cOldest = await getOldest(WaiveOffModel, { schoolId, status: 'pending_approval' }, 'requestedAt');
    const slOldest = await getOldest(StaffLeaveApplicationModel, { schoolId, status: 'pending', currentLevel: 1 }, 'appliedOn');
    const rOldest = await getOldest(RefundRequestModel, { schoolId, status: 'pending_approval' }, 'requestedAt');
    const stOldest = await getOldest(StudentLeaveModel, { schoolId, status: 'pending' }, 'appliedOn');
    const aOldest = await getOldest(EnquiryModel, { schoolId, status: { $in: ['new', 'contacted', 'follow_up'] } }, 'createdAt');

    return [
      { id: '1', kind: 'concession', count: concessions, oldestPendingSince: cOldest },
      { id: '2', kind: 'staff_leave', count: staffLeave, oldestPendingSince: slOldest },
      { id: '3', kind: 'refund', count: refunds, oldestPendingSince: rOldest },
      { id: '4', kind: 'student_leave', count: studentLeave, oldestPendingSince: stOldest },
      { id: '5', kind: 'admission', count: pendingAdmissions, oldestPendingSince: aOldest },
    ];
  },

  async getRecentAdmissions(schoolId: string) {
    const students = await StudentModel.find({ schoolId })
      .sort({ admittedAt: -1 })
      .limit(5)
      .select('name className section admissionNumber admittedAt feeStatus photoUrl')
      .lean();

    return students.map(s => ({
      id: s._id.toString(),
      name: s.name,
      classSection: `${s.className} ${s.section}`,
      admissionNumber: s.admissionNumber,
      admittedAt: s.admittedAt ? new Date(s.admittedAt).toISOString() : new Date().toISOString(),
      feeStatus: s.feeStatus,
      photoUrl: s.photoUrl || null,
    }));
  },

  async getNotices(schoolId: string) {
    const [announcements, circulars] = await Promise.all([
      AnnouncementModel.find({ schoolId })
        .sort({ pinned: -1, createdAt: -1 })
        .limit(5)
        .select('title audience createdAt')
        .lean(),
      CircularModel.find({ schoolId, status: 'published' })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title audience createdAt')
        .lean(),
    ]);

    const combined = [
      ...announcements.map((a) => ({
        id: a._id.toString(),
        title: a.title,
        audience: a.audience && a.audience.length > 0 ? a.audience[0] : 'all',
        publishedAt: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
      })),
      ...circulars.map((c) => ({
        id: c._id.toString(),
        title: c.title,
        audience: c.audience && c.audience.length > 0 ? c.audience[0] : 'all',
        publishedAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
      })),
    ];

    combined.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    return combined.slice(0, 3);
  }
};
