import { HolidayModel } from '../academics/academics.models';
import { StudentModel } from '../students/student.model';
import { AttendanceModel, OverrideModel } from './attendance.models';

type Doc = Record<string, unknown> & { _id: unknown };
const round = (n: number): number => Math.round(n);

/** attendance classKey is `${className}-${section}` (split on the last hyphen). */
function parseClassKey(classKey: string): { className: string; section: string } {
  const idx = classKey.lastIndexOf('-');
  if (idx === -1) return { className: classKey, section: 'A' };
  return { className: classKey.slice(0, idx), section: classKey.slice(idx + 1) };
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const a = new Date(start);
  const b = new Date(end);
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

interface SavePayload {
  date: string;
  classKey: string;
  attendance: Array<{ studentId: string; status: string; time?: string; remarks?: string }>;
}

export const attendanceService = {
  async getMarkSession(schoolId: string, className: string, section: string, date: string) {
    const students = await StudentModel.find({ schoolId, className, section })
      .sort({ rollNumber: 1 })
      .lean();
    const records = await AttendanceModel.find({
      schoolId,
      date,
      studentId: { $in: students.map((s) => s._id) },
    }).lean();
    const recMap = new Map(records.map((r) => [String(r.studentId), r]));

    return {
      date,
      classLabel: className,
      section,
      lockStatus: records.length > 0 ? 'locked' : 'unlocked',
      cutoffTime: '10:00 AM',
      students: students.map((s) => {
        const r = recMap.get(String(s._id));
        return {
          id: String(s._id),
          rollNumber: s.rollNumber ?? '',
          name: s.name,
          photoUrl: s.photoUrl,
          status: r?.status ?? null,
          time: r?.time,
          remarks: r?.remarks,
          leaveType: r?.leaveType,
        };
      }),
    };
  },

  async save(schoolId: string, payload: SavePayload, markedBy: string) {
    const { className, section } = parseClassKey(payload.classKey);
    await Promise.all(
      payload.attendance.map((a) =>
        AttendanceModel.updateOne(
          { schoolId, studentId: a.studentId, date: payload.date },
          {
            $set: {
              schoolId,
              studentId: a.studentId,
              date: payload.date,
              status: a.status,
              time: a.time,
              remarks: a.remarks,
              className,
              section,
              markedBy,
            },
          },
          { upsert: true },
        ),
      ),
    );
    return { saved: payload.attendance.length };
  },

  async saveAndAlert(schoolId: string, payload: SavePayload, markedBy: string) {
    const { saved } = await this.save(schoolId, payload, markedBy);
    const absentIds = payload.attendance.filter((a) => a.status === 'absent').map((a) => a.studentId);
    if (absentIds.length > 0) {
      await AttendanceModel.updateMany(
        { schoolId, date: payload.date, studentId: { $in: absentIds } },
        { $set: { alertSent: true } },
      );
    }
    return { saved, alertsSent: absentIds.length };
  },

  async sendAbsenteeAlerts(schoolId: string, date: string, studentIds?: string[]) {
    const filter: Record<string, unknown> = { schoolId, date, status: 'absent' };
    if (studentIds && studentIds.length > 0) filter.studentId = { $in: studentIds };
    const res = await AttendanceModel.updateMany(filter, { $set: { alertSent: true } });
    return { sent: res.modifiedCount };
  },

  async override(
    schoolId: string,
    payload: SavePayload & { reason: string; originalAttendance: Array<{ studentId: string; status: string }> },
    overrideBy: string,
  ) {
    const { className, section } = parseClassKey(payload.classKey);
    for (const a of payload.attendance) {
      const original = payload.originalAttendance.find((o) => o.studentId === a.studentId);
      if (!original || original.status === a.status) continue;
      await AttendanceModel.updateOne(
        { schoolId, studentId: a.studentId, date: payload.date },
        { $set: { status: a.status, className, section, markedBy: overrideBy } },
        { upsert: true },
      );
      const student = await StudentModel.findOne({ _id: a.studentId, schoolId }).lean();
      await OverrideModel.create({
        schoolId,
        date: payload.date,
        classLabel: payload.classKey,
        studentName: student?.name ?? a.studentId,
        originalStatus: original.status,
        newStatus: a.status,
        reason: payload.reason,
        overrideBy,
        timestamp: new Date(),
      });
    }
    return { entries: payload.attendance.length };
  },

  async overrideHistory(schoolId: string) {
    const docs = await OverrideModel.find({ schoolId }).sort({ timestamp: -1 }).lean();
    return docs.map((d: Doc) => ({
      id: String(d._id),
      date: d.date,
      classLabel: d.classLabel,
      studentName: d.studentName,
      originalStatus: d.originalStatus,
      newStatus: d.newStatus,
      reason: d.reason,
      overrideBy: d.overrideBy,
      timestamp: new Date(d.timestamp as string).toISOString(),
    }));
  },

  /** Group students by className+section with their record for `date`.
   * `classKey` restricts to one class — used to scope a teacher to the class
   * they're incharge of; admins/principals/coordinators pass `undefined`. */
  async _groups(schoolId: string, date: string, classKey?: string) {
    const students = await filteredStudents(schoolId, classKey);
    const records = await AttendanceModel.find({ schoolId, date }).lean();
    const recByStudent = new Map(records.map((r) => [String(r.studentId), r]));
    const groups = new Map<string, { className: string; section: string; students: Doc[] }>();
    for (const s of students) {
      const key = `${s.className}-${s.section}`;
      if (!groups.has(key)) groups.set(key, { className: s.className ?? '', section: s.section ?? '', students: [] });
      groups.get(key)!.students.push(s);
    }
    return { groups, recByStudent, records, totalStudents: students.length };
  },

  async dashboard(schoolId: string, date: string, classKey?: string) {
    const { groups, recByStudent, totalStudents } = await this._groups(schoolId, date, classKey);
    const scopedIds = new Set([...groups.values()].flatMap((g) => g.students.map((s) => String(s._id))));
    const records = [...recByStudent.values()].filter((r) => scopedIds.has(String(r.studentId)));
    const present = records.filter((r) => r.status === 'present').length;
    const absent = records.filter((r) => r.status === 'absent').length;
    const late = records.filter((r) => r.status === 'late').length;

    const classSummaries = [...groups.entries()].map(([key, g]) => {
      const total = g.students.length;
      const marked = g.students.filter((s) => recByStudent.has(String(s._id)));
      const p = marked.filter((s) => recByStudent.get(String(s._id))?.status === 'present').length;
      const status = marked.length === 0 ? 'not_marked' : marked.length < total ? 'partial' : 'marked';
      return {
        classKey: key,
        classLabel: g.className,
        section: g.section,
        present: p,
        total,
        percentage: total ? round((p / total) * 100) : 0,
        status,
      };
    });

    return {
      date,
      overallPercent: totalStudents ? round((present / totalStudents) * 100) : 0,
      totalPresent: present,
      totalAbsent: absent,
      notMarkedCount: Math.max(0, totalStudents - records.length),
      lateCount: late,
      classSummaries,
    };
  },

  async dailySummary(schoolId: string, date: string, classKey?: string) {
    const { groups, recByStudent } = await this._groups(schoolId, date, classKey);
    return [...groups.values()].map((g) => {
      const marks = g.students.map((s) => recByStudent.get(String(s._id))?.status).filter(Boolean);
      const count = (st: string) => marks.filter((m) => m === st).length;
      const present = count('present');
      const total = g.students.length;
      return {
        classLabel: g.className,
        section: g.section,
        total,
        present,
        absent: count('absent'),
        leave: count('leave'),
        halfDay: count('half_day'),
        late: count('late'),
        percentage: total ? round((present / total) * 100) : 0,
        notMarked: marks.length === 0,
      };
    });
  },

  async absentees(schoolId: string, date: string, classKey?: string) {
    const records = await AttendanceModel.find({ schoolId, date, status: 'absent' }).lean();
    const students = await StudentModel.find({
      schoolId,
      _id: { $in: records.map((r) => r.studentId) },
    }).lean();
    const map = new Map(students.map((s) => [String(s._id), s]));
    const scoped = classKey ? splitClassKey(classKey) : null;
    return records
      .filter((r) => {
        if (!scoped) return true;
        const s = map.get(String(r.studentId));
        return s?.className === scoped.className && (!scoped.section || s?.section === scoped.section);
      })
      .map((r) => {
        const s = map.get(String(r.studentId));
        return {
          studentId: String(r.studentId),
          studentName: s?.name ?? '',
          classLabel: `${s?.className ?? ''}-${s?.section ?? ''}`,
          rollNumber: s?.rollNumber ?? '',
          parentMobile: s?.parents?.fatherMobile ?? s?.mobile ?? '',
          alertSent: Boolean(r.alertSent),
          reason: r.remarks,
        };
      });
  },

  // ─── Report aggregations (matrices) ───
  async monthlyReport(schoolId: string, query: { classKey?: string; month?: string }) {
    const students = await filteredStudents(schoolId, query.classKey);
    const ids = students.map((s) => s._id);
    const recFilter: Record<string, unknown> = { schoolId, studentId: { $in: ids } };
    if (query.month) recFilter.date = { $regex: `^${query.month}` };
    const records = await AttendanceModel.find(recFilter).lean();
    const byStudent = groupStats(records);
    return students
      .map((s) => {
        const st = byStudent.get(String(s._id)) ?? { present: 0, absent: 0, leave: 0, late: 0, total: 0 };
        return {
          studentId: String(s._id),
          rollNumber: s.rollNumber ?? '',
          name: s.name,
          workingDays: st.total,
          present: st.present,
          absent: st.absent,
          leave: st.leave,
          late: st.late,
          percentage: st.total ? Math.round((st.present / st.total) * 100) : 0,
        };
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  },

  async lowAttendance(schoolId: string, threshold: number, classKey?: string) {
    const students = await filteredStudents(schoolId, classKey);
    const ids = students.map((s) => s._id);
    const records = await AttendanceModel.find({ schoolId, studentId: { $in: ids } }).lean();
    const byStudent = groupStats(records);
    return students
      .map((s) => {
        const st = byStudent.get(String(s._id)) ?? { present: 0, total: 0 };
        const percentage = st.total ? Math.round((st.present / st.total) * 100) : 100;
        return {
          studentId: String(s._id),
          studentName: s.name,
          classLabel: `${s.className ?? ''}-${s.section ?? ''}`,
          percentage,
          presentDays: st.present,
          totalDays: st.total,
        };
      })
      .filter((r) => r.totalDays > 0 && r.percentage < threshold)
      .sort((a, b) => a.percentage - b.percentage);
  },

  async registerMatrix(schoolId: string, query: { classKey?: string; month?: string }) {
    const students = await filteredStudents(schoolId, query.classKey);
    const ids = students.map((s) => s._id);
    const recFilter: Record<string, unknown> = { schoolId, studentId: { $in: ids } };
    if (query.month) recFilter.date = { $regex: `^${query.month}` };
    const records = await AttendanceModel.find(recFilter).lean();
    const dates = [...new Set(records.map((r) => r.date as string))].sort();
    const cells: Record<string, Record<string, string>> = {};
    for (const r of records) {
      const sid = String(r.studentId);
      (cells[sid] ??= {})[r.date as string] = r.status as string;
    }
    return {
      students: students.map((s) => ({ id: String(s._id), name: s.name, rollNumber: s.rollNumber ?? '' })),
      dates,
      cells,
    };
  },

  // ── Student calendar views (served under /students/:id/attendance) ──
  async studentMonth(schoolId: string, studentId: string, year: number, month: number) {
    const mm = String(month).padStart(2, '0');
    const daysInMonth = new Date(year, month, 0).getDate();
    const start = `${year}-${mm}-01`;
    const end = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

    const records = await AttendanceModel.find({ schoolId, studentId, date: { $gte: start, $lte: end } }).lean();
    const recMap = new Map(records.map((r) => [r.date, r.status as string]));

    const holidays = await HolidayModel.find({ schoolId }).lean();
    const holidaySet = new Set<string>();
    for (const h of holidays) for (const d of eachDate(h.startDate, h.endDate)) holidaySet.add(d);

    let present = 0;
    let absent = 0;
    let leave = 0;
    let halfDay = 0;
    let workingDays = 0;
    const days: Array<{ date: string; status: string }> = [];

    for (let d = 1; d <= daysInMonth; d += 1) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`;
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) {
        days.push({ date: dateStr, status: 'weekend' });
        continue;
      }
      if (holidaySet.has(dateStr)) {
        days.push({ date: dateStr, status: 'holiday' });
        continue;
      }
      workingDays += 1;
      const rec = recMap.get(dateStr);
      if (!rec) continue; // unmarked working day
      if (rec === 'present' || rec === 'late') present += 1;
      else if (rec === 'absent') absent += 1;
      else if (rec === 'leave') leave += 1;
      else if (rec === 'half_day') halfDay += 1;
      days.push({ date: dateStr, status: rec === 'late' ? 'present' : rec });
    }

    return {
      year,
      month,
      workingDays,
      present,
      absent,
      leave,
      halfDay,
      percentage: workingDays ? round((present / workingDays) * 100) : 0,
      days,
    };
  },

  async studentAnnual(schoolId: string, studentId: string) {
    const records = await AttendanceModel.find({ schoolId, studentId }).lean();
    const holidays = await HolidayModel.find({ schoolId }).lean();
    const holidaySet = new Set<string>();
    for (const h of holidays) for (const d of eachDate(h.startDate, h.endDate)) holidaySet.add(d);

    const byMonth = new Map<string, { present: number; absent: number }>();
    for (const r of records) {
      const key = r.date.slice(0, 7); // YYYY-MM
      if (!byMonth.has(key)) byMonth.set(key, { present: 0, absent: 0 });
      const b = byMonth.get(key)!;
      if (r.status === 'present' || r.status === 'late') b.present += 1;
      else if (r.status === 'absent') b.absent += 1;
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return [...byMonth.entries()]
      .sort()
      .map(([key, b]) => {
        const [yy, mm] = key.split('-').map(Number);
        const daysInMonth = new Date(yy, mm, 0).getDate();
        let workingDays = 0;
        for (let d = 1; d <= daysInMonth; d += 1) {
          const dateStr = `${key}-${String(d).padStart(2, '0')}`;
          const dow = new Date(yy, mm - 1, d).getDay();
          if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) workingDays += 1;
        }
        return {
          month: `${MONTHS[mm - 1]} ${yy}`,
          workingDays,
          present: b.present,
          absent: b.absent,
          percentage: workingDays ? round((b.present / workingDays) * 100) : 0,
        };
      });
  },
};

function splitClassKey(classKey: string): { className: string; section?: string } {
  const idx = classKey.lastIndexOf('-');
  if (idx === -1) return { className: classKey };
  return { className: classKey.slice(0, idx), section: classKey.slice(idx + 1) };
}

async function filteredStudents(schoolId: string, classKey?: string) {
  const filter: Record<string, unknown> = { schoolId, profileStatus: 'active' };
  if (classKey && classKey !== 'all') {
    const { className, section } = splitClassKey(classKey);
    filter.className = className;
    if (section) filter.section = section;
  }
  return StudentModel.find(filter).sort({ rollNumber: 1 }).lean();
}

type Stats = { present: number; absent: number; leave: number; late: number; total: number };
function groupStats(records: Array<{ studentId: unknown; status: unknown }>): Map<string, Stats> {
  const map = new Map<string, Stats>();
  for (const r of records) {
    const sid = String(r.studentId);
    const st = map.get(sid) ?? { present: 0, absent: 0, leave: 0, late: 0, total: 0 };
    st.total += 1;
    const s = r.status as string;
    if (s === 'present') st.present += 1;
    else if (s === 'absent') st.absent += 1;
    else if (s === 'leave') st.leave += 1;
    else if (s === 'late') st.late += 1;
    else if (s === 'half_day') st.present += 1;
    map.set(sid, st);
  }
  return map;
}
