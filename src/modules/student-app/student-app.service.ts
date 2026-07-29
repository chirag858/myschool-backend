import { ApiError } from '../../lib/api-error';
import { AnnouncementModel, CircularModel } from '../communication/communication.models';
import { IssueModel, LibraryMemberModel } from '../library/library.models';
import { SchoolModel } from '../school/school.model';
import { StudentModel } from '../students/student.model';
import { SubmissionModel, TeacherAssignmentModel } from '../teacher/teacher.models';
import { UserModel } from '../user/user.model';
import { NoticeReadModel } from './student-app.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const keyOf = (cn: string, sec: string): string => `${cn}-${sec}`;

/** Resolve the logged-in student's roster record (linked by the user's mobile). */
async function resolveStudent(schoolId: string, userId: string): Promise<Doc> {
  const user = await UserModel.findById(userId).lean();
  const byMobile = user?.mobile
    ? await StudentModel.findOne({ schoolId, mobile: user.mobile }).lean()
    : null;
  const s = byMobile ?? (await StudentModel.findOne({ schoolId, profileStatus: 'active' }).sort({ rollNumber: 1 }).lean());
  if (!s) throw ApiError.notFound('No student record for this account');
  return s as Doc;
}

const SUB_STATUS: Record<string, string> = {
  pending: 'not_submitted',
  submitted: 'submitted',
  late: 'submitted_late',
  graded: 'graded',
};

function assignmentView(a: Doc, sub: Doc | null): Record<string, unknown> {
  const status = sub ? SUB_STATUS[String(sub.status)] ?? 'not_submitted' : 'not_submitted';
  const submission = sub && sub.status !== 'pending'
    ? { files: (sub.files as unknown[]) ?? [], text: sub.textContent, submittedAt: sub.submittedAt, late: Boolean(sub.late) }
    : undefined;
  const grade = sub && sub.status === 'graded'
    ? { marks: Number(sub.marks ?? 0), maxMarks: Number(a.maxMarks ?? 100), feedback: sub.feedback }
    : undefined;
  return {
    id: String(a._id),
    title: a.title,
    subject: a.subject ?? '',
    description: a.description ?? '',
    teacher: 'Teacher',
    assignedDate: a.assignedDate ?? '',
    dueDate: a.dueDate ?? '',
    maxMarks: a.maxMarks,
    attachments: [],
    status,
    submission,
    grade,
    submissionOpen: status !== 'graded',
    allowLate: true,
    allowText: true,
  };
}

function noticeView(d: Doc, kind: 'circular' | 'announcement', readSet: Set<string>): Record<string, unknown> {
  const id = String(d._id);
  const category = kind === 'circular' ? (String(d.priority) === 'urgent' ? 'exam' : 'general') : 'event';
  return {
    id,
    category,
    title: d.title,
    body: d.body ?? '',
    createdAt: (d.dateOfIssue as string) || (d.postedAt as string) || (d.createdAt as Date)?.toISOString?.() || '',
    read: readSet.has(id),
    attachments: [],
  };
}

export const studentAppService = {
  async me(schoolId: string, userId: string) {
    const s = await resolveStudent(schoolId, userId);
    return {
      id: String(s._id),
      name: s.name,
      className: (s.className as string) ?? '',
      section: (s.section as string) ?? '',
      roll: (s.rollNumber as string) ?? '',
      avatarUrl: s.photoUrl,
    };
  },

  async assignments(schoolId: string, userId: string) {
    const s = await resolveStudent(schoolId, userId);
    const key = keyOf((s.className as string) ?? '', (s.section as string) ?? '');
    const list = await TeacherAssignmentModel.find({ schoolId, classKey: key }).sort({ assignedDate: -1 }).lean();
    const subs = await SubmissionModel.find({ schoolId, studentId: String(s._id) }).lean();
    const subByAssignment = new Map(subs.map((x) => [String(x.assignmentId), x as unknown as Doc]));
    return list.map((a) => assignmentView(a as Doc, subByAssignment.get(String(a._id)) ?? null));
  },

  async submit(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const s = await resolveStudent(schoolId, userId);
    const assignment = await TeacherAssignmentModel.findOne({ _id: String(payload.assignmentId), schoolId }).lean();
    if (!assignment) throw ApiError.notFound('Assignment not found');
    const late = Boolean(assignment.dueDate && nowIso().slice(0, 10) > String(assignment.dueDate).slice(0, 10));
    const files = (payload.files as unknown[]) ?? [];
    const doc = await SubmissionModel.findOneAndUpdate(
      { schoolId, assignmentId: String(payload.assignmentId), studentId: String(s._id) },
      {
        $set: {
          schoolId,
          assignmentId: String(payload.assignmentId),
          studentId: String(s._id),
          studentName: s.name,
          className: keyOf((s.className as string) ?? '', (s.section as string) ?? ''),
          status: late ? 'late' : 'submitted',
          late,
          files,
          fileName: (files[0] as { name?: string })?.name,
          textContent: payload.text,
          submittedAt: nowIso(),
        },
      },
      { new: true, upsert: true },
    );
    return assignmentView(assignment as Doc, doc.toObject() as Doc);
  },

  async notices(schoolId: string, userId: string) {
    const s = await resolveStudent(schoolId, userId);
    const [circulars, announcements, reads] = await Promise.all([
      CircularModel.find({ schoolId, status: 'published' }).sort({ dateOfIssue: -1 }).lean(),
      AnnouncementModel.find({ schoolId }).sort({ postedAt: -1 }).lean(),
      NoticeReadModel.find({ schoolId, studentId: String(s._id) }).lean(),
    ]);
    const readSet = new Set(reads.map((r) => String(r.noticeId)));
    return [
      ...circulars.map((c) => noticeView(c as Doc, 'circular', readSet)),
      ...announcements.map((a) => noticeView(a as Doc, 'announcement', readSet)),
    ].sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1));
  },

  async markNoticeRead(schoolId: string, userId: string, noticeId: string) {
    const s = await resolveStudent(schoolId, userId);
    await NoticeReadModel.updateOne(
      { schoolId, studentId: String(s._id), noticeId },
      { $set: { schoolId, studentId: String(s._id), noticeId } },
      { upsert: true },
    );
  },

  async markAllNoticesRead(schoolId: string, userId: string) {
    const notices = await this.notices(schoolId, userId);
    const s = await resolveStudent(schoolId, userId);
    await Promise.all(
      notices.map((n) =>
        NoticeReadModel.updateOne(
          { schoolId, studentId: String(s._id), noticeId: String(n.id) },
          { $set: { schoolId, studentId: String(s._id), noticeId: String(n.id) } },
          { upsert: true },
        ),
      ),
    );
  },

  async library(schoolId: string, userId: string) {
    const s = await resolveStudent(schoolId, userId);
    const member = await LibraryMemberModel.findOne({ schoolId, name: s.name, type: 'student' }).lean();
    if (!member) return { membershipId: undefined, issued: [], history: [], fine: 0 };
    const issues = await IssueModel.find({ schoolId, memberId: member._id }).sort({ issueDate: -1 }).lean();
    const map = (i: Doc) => ({
      id: String(i._id),
      title: (i.title as string) ?? '',
      author: i.author as string | undefined,
      issuedOn: (i.issueDate as string) ?? '',
      dueOn: (i.dueDate as string) ?? '',
      returned: i.status === 'returned',
      returnedOn: i.returnDate as string | undefined,
      overdue: i.status === 'overdue',
    });
    const all = issues.map((i) => map(i as Doc));
    return {
      membershipId: String(member._id),
      issued: all.filter((b) => !b.returned),
      history: all.filter((b) => b.returned),
      fine: issues.filter((i) => i.fineStatus === 'pending').reduce((sum, i) => sum + Number(i.fineAmount ?? 0), 0),
    };
  },

  async idCard(schoolId: string, userId: string) {
    const s = await resolveStudent(schoolId, userId);
    const school = await SchoolModel.findById(schoolId).lean();
    const addr = (s.currentAddress as { line1?: string; city?: string }) ?? {};
    return {
      studentId: String(s._id),
      name: s.name,
      admissionNumber: (s.admissionNumber as string) ?? '',
      className: (s.className as string) ?? '',
      section: (s.section as string) ?? '',
      roll: (s.rollNumber as string) ?? '',
      photoUrl: s.photoUrl,
      bloodGroup: (s.bloodGroup as string) ?? '',
      fatherName: (s.fatherName as string) ?? '',
      address: [addr.line1, addr.city].filter(Boolean).join(', '),
      validUpto: (school?.expiryDate as string) ?? '',
      emergencyContacts: [
        { name: (s.fatherName as string) ?? 'Guardian', relation: 'Father', phone: (s.mobile as string) ?? '' },
      ],
      qrValue: `MSC:${(school?.code as string) ?? 'MSC'}:${s.admissionNumber}`,
      school: {
        name: (school?.name as string) ?? 'School',
        shortName: (school?.code as string) ?? 'MSC',
        logoUrl: (school?.branding as { logoUrl?: string })?.logoUrl,
        primaryColor: (school?.branding as { primaryColor?: string })?.primaryColor,
      },
    };
  },

  async dashboardSummary(schoolId: string, userId: string) {
    const s = await resolveStudent(schoolId, userId);
    const [assignments, notices, lib] = await Promise.all([
      this.assignments(schoolId, userId),
      this.notices(schoolId, userId),
      this.library(schoolId, userId),
    ]);
    return {
      studentId: String(s._id),
      badges: {
        assignments: assignments.filter((a) => a.status === 'not_submitted').length,
        notices: notices.filter((n) => !n.read).length,
        library: lib.issued.filter((b) => b.overdue).length,
      },
    };
  },
};
