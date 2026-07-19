import { ApiError } from '../../lib/api-error';
import { BookCopyModel, BookModel, IssueModel, LibraryMemberModel } from './library.models';

type Doc = Record<string, unknown> & { _id: unknown };
const today = (): string => new Date().toISOString().slice(0, 10);
function rx(s: string): RegExp {
  return new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function toBook(d: Doc) {
  return {
    id: String(d._id),
    title: d.title,
    authors: d.authors ?? [],
    publisher: d.publisher ?? '',
    edition: d.edition ?? '',
    isbn: d.isbn ?? '',
    publicationYear: d.publicationYear ?? 2000,
    category: d.category ?? 'other',
    subject: d.subject,
    classLevels: d.classLevels ?? [],
    language: d.language ?? 'en',
    totalCopies: d.totalCopies ?? 0,
    availableCopies: d.availableCopies ?? 0,
    issuedCopies: d.issuedCopies ?? 0,
    lostCopies: d.lostCopies ?? 0,
    location: d.location ?? '',
    pricePerCopy: d.pricePerCopy ?? 0,
    description: d.description,
    coverUrl: d.coverUrl,
  };
}
function toCopy(d: Doc) {
  return {
    id: String(d._id),
    bookId: String(d.bookId),
    copyNumber: d.copyNumber ?? 1,
    barcode: d.barcode ?? '',
    condition: d.condition ?? 'good',
    status: d.status ?? 'available',
    currentHolderId: d.currentHolderId,
    currentHolderName: d.currentHolderName,
  };
}
function toMember(d: Doc) {
  return {
    id: String(d._id),
    type: d.type,
    name: d.name,
    photoUrl: d.photoUrl,
    classOrDesignation: d.classOrDesignation ?? '',
    currentIssued: d.currentIssued ?? 0,
    overdueCount: d.overdueCount ?? 0,
    totalFinesPaid: d.totalFinesPaid ?? 0,
    outstandingFine: d.outstandingFine ?? 0,
    memberSince: d.memberSince ?? '',
    blocked: d.blocked ?? false,
    maxBooksAllowed: d.maxBooksAllowed ?? 3,
  };
}
function toIssue(d: Doc) {
  return {
    id: String(d._id),
    bookId: String(d.bookId),
    bookTitle: d.bookTitle ?? '',
    copyId: String(d.copyId),
    barcode: d.barcode ?? '',
    memberId: String(d.memberId),
    memberName: d.memberName ?? '',
    memberType: d.memberType ?? 'student',
    memberClassOrDesignation: d.memberClassOrDesignation ?? '',
    issueDate: d.issueDate ?? '',
    dueDate: d.dueDate ?? '',
    returnDate: d.returnDate,
    status: d.status ?? 'active',
    fineAmount: d.fineAmount ?? 0,
    fineStatus: d.fineStatus ?? 'pending',
    fineWaivedReason: d.fineWaivedReason,
    conditionOnReturn: d.conditionOnReturn,
    remarks: d.remarks,
  };
}

export const libraryService = {
  async kpi(schoolId: string) {
    const books = await BookModel.find({ schoolId }).lean();
    const active = await IssueModel.find({ schoolId, status: { $in: ['active', 'overdue'] } }).lean();
    const t = today();
    const pending = await IssueModel.find({ schoolId, fineStatus: 'pending', fineAmount: { $gt: 0 } }).lean();
    return {
      totalTitles: books.length,
      totalCopies: books.reduce((s, b) => s + (b.totalCopies ?? 0), 0),
      booksIssued: active.length,
      booksOverdue: active.filter((i) => i.dueDate && i.dueDate < t).length,
      pendingFine: pending.reduce((s, i) => s + (i.fineAmount ?? 0), 0),
    };
  },

  async activity(schoolId: string) {
    const issues = await IssueModel.find({ schoolId }).sort({ updatedAt: -1 }).limit(15).lean();
    return issues.map((i) => ({
      id: String(i._id),
      bookTitle: i.bookTitle ?? '',
      memberName: i.memberName ?? '',
      classOrDesignation: i.memberClassOrDesignation ?? '',
      action: i.status === 'returned' ? 'returned' : 'issued',
      date: i.returnDate || i.issueDate || '',
    }));
  },

  async getBooks(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.category && q.category !== 'all') filter.category = q.category;
    if (q.language && q.language !== 'all') filter.language = q.language;
    if (q.search?.trim()) filter.$or = [{ title: rx(q.search) }, { isbn: rx(q.search) }, { authors: rx(q.search) }];
    const docs = await BookModel.find(filter).sort({ title: 1 }).lean();
    return docs.map(toBook);
  },

  async getBook(schoolId: string, id: string) {
    const d = await BookModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Book not found');
    return toBook(d);
  },

  async getCopies(schoolId: string, bookId: string) {
    const docs = await BookCopyModel.find({ schoolId, bookId }).sort({ copyNumber: 1 }).lean();
    return docs.map(toCopy);
  },

  async upsertBook(schoolId: string, book: Record<string, unknown>) {
    const fields = {
      title: book.title,
      authors: book.authors,
      publisher: book.publisher,
      edition: book.edition,
      isbn: book.isbn,
      publicationYear: book.publicationYear,
      category: book.category,
      subject: book.subject,
      classLevels: book.classLevels,
      language: book.language,
      location: book.location,
      pricePerCopy: book.pricePerCopy,
      description: book.description,
      coverUrl: book.coverUrl,
    };
    const id = String(book.id ?? '');
    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      const existing = await BookModel.findOne({ _id: id, schoolId });
      if (existing) {
        Object.assign(existing, fields);
        await existing.save();
        return toBook(existing.toObject());
      }
    }
    const total = Number(book.totalCopies) || 1;
    const doc = await BookModel.create({
      schoolId,
      ...fields,
      totalCopies: total,
      availableCopies: total,
      issuedCopies: 0,
      lostCopies: 0,
    });
    const copies = Array.from({ length: total }, (_, i) => ({
      schoolId,
      bookId: doc._id,
      copyNumber: i + 1,
      barcode: `${doc.isbn || 'BK'}-${String(i + 1).padStart(3, '0')}`,
      condition: 'good',
      status: 'available',
    }));
    if (copies.length) await BookCopyModel.insertMany(copies);
    return toBook(doc.toObject());
  },

  async deleteBook(schoolId: string, id: string) {
    await BookModel.deleteOne({ _id: id, schoolId });
    await BookCopyModel.deleteMany({ schoolId, bookId: id });
    return { success: true };
  },

  async getMembers(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.type && q.type !== 'all') filter.type = q.type;
    if (q.search?.trim()) filter.name = rx(q.search);
    const docs = await LibraryMemberModel.find(filter).sort({ name: 1 }).lean();
    return docs.map(toMember);
  },

  async getMember(schoolId: string, id: string) {
    const d = await LibraryMemberModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Member not found');
    return toMember(d);
  },

  async toggleBlock(schoolId: string, id: string) {
    const doc = await LibraryMemberModel.findOne({ _id: id, schoolId });
    if (!doc) throw ApiError.notFound('Member not found');
    doc.blocked = !doc.blocked;
    await doc.save();
    return toMember(doc.toObject());
  },

  async getIssues(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.status && q.status !== 'all') filter.status = q.status;
    if (q.memberId) filter.memberId = q.memberId;
    const docs = await IssueModel.find(filter).sort({ createdAt: -1 }).lean();
    // Flag overdue active issues on read.
    const t = today();
    return docs.map((d) => {
      const issue = toIssue(d);
      if (issue.status === 'active' && issue.dueDate && issue.dueDate < t) issue.status = 'overdue';
      return issue;
    });
  },

  async issueBook(schoolId: string, payload: { memberId: string; bookId: string; copyId: string; dueDate: string; remarks?: string }) {
    const [book, member, copy] = await Promise.all([
      BookModel.findOne({ _id: payload.bookId, schoolId }),
      LibraryMemberModel.findOne({ _id: payload.memberId, schoolId }),
      BookCopyModel.findOne({ _id: payload.copyId, schoolId }),
    ]);
    if (!book || !member || !copy) throw ApiError.notFound('Book, member or copy not found');
    if (member.blocked) throw ApiError.badRequest('Member is blocked');
    if (copy.status !== 'available') throw ApiError.conflict('Copy is not available');

    const issue = await IssueModel.create({
      schoolId,
      bookId: book._id,
      bookTitle: book.title,
      copyId: copy._id,
      barcode: copy.barcode,
      memberId: member._id,
      memberName: member.name,
      memberType: member.type,
      memberClassOrDesignation: member.classOrDesignation,
      issueDate: today(),
      dueDate: payload.dueDate,
      status: 'active',
      fineAmount: 0,
      fineStatus: 'pending',
      remarks: payload.remarks,
    });
    copy.status = 'issued';
    copy.currentHolderId = String(member._id);
    copy.currentHolderName = member.name;
    await copy.save();
    book.availableCopies = Math.max(0, (book.availableCopies ?? 0) - 1);
    book.issuedCopies = (book.issuedCopies ?? 0) + 1;
    await book.save();
    member.currentIssued = (member.currentIssued ?? 0) + 1;
    await member.save();
    return toIssue(issue.toObject());
  },

  async returnBook(schoolId: string, payload: { issueId: string; condition: string; fineAmount: number; waived: boolean; waiveReason?: string; remarks?: string }) {
    const issue = await IssueModel.findOne({ _id: payload.issueId, schoolId });
    if (!issue) throw ApiError.notFound('Issue not found');
    const fine = payload.fineAmount ?? 0;
    issue.returnDate = today();
    issue.status = 'returned';
    issue.conditionOnReturn = payload.condition;
    issue.fineAmount = fine;
    issue.fineStatus = payload.waived ? 'waived' : fine > 0 ? 'paid' : 'pending';
    issue.fineWaivedReason = payload.waiveReason;
    issue.remarks = payload.remarks;
    await issue.save();

    const lost = payload.condition === 'lost';
    const copy = await BookCopyModel.findById(issue.copyId);
    if (copy) {
      copy.status = lost ? 'lost' : payload.condition.includes('damage') ? 'damaged' : 'available';
      copy.currentHolderId = undefined;
      copy.currentHolderName = undefined;
      await copy.save();
    }
    const book = await BookModel.findById(issue.bookId);
    if (book) {
      book.issuedCopies = Math.max(0, (book.issuedCopies ?? 0) - 1);
      if (lost) book.lostCopies = (book.lostCopies ?? 0) + 1;
      else book.availableCopies = (book.availableCopies ?? 0) + 1;
      await book.save();
    }
    const member = await LibraryMemberModel.findById(issue.memberId);
    if (member) {
      member.currentIssued = Math.max(0, (member.currentIssued ?? 0) - 1);
      if (issue.fineStatus === 'paid') member.totalFinesPaid = (member.totalFinesPaid ?? 0) + fine;
      await member.save();
    }
    return toIssue(issue.toObject());
  },

  async collectFine(schoolId: string, issueId: string) {
    const issue = await IssueModel.findOne({ _id: issueId, schoolId });
    if (!issue) throw ApiError.notFound('Issue not found');
    issue.fineStatus = 'paid';
    await issue.save();
    const member = await LibraryMemberModel.findById(issue.memberId);
    if (member) {
      member.totalFinesPaid = (member.totalFinesPaid ?? 0) + (issue.fineAmount ?? 0);
      await member.save();
    }
    return toIssue(issue.toObject());
  },

  async waiveFine(schoolId: string, issueId: string, reason: string) {
    const issue = await IssueModel.findOne({ _id: issueId, schoolId });
    if (!issue) throw ApiError.notFound('Issue not found');
    issue.fineStatus = 'waived';
    issue.fineWaivedReason = reason;
    await issue.save();
    return toIssue(issue.toObject());
  },
};
