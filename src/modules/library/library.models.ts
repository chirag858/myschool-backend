import { Schema, model, type InferSchemaType } from 'mongoose';

const bookSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    title: { type: String, required: true },
    authors: { type: [String], default: [] },
    publisher: { type: String, default: '' },
    edition: { type: String, default: '' },
    isbn: { type: String, default: '' },
    publicationYear: { type: Number, default: 2000 },
    category: { type: String, default: 'other' },
    subject: String,
    classLevels: { type: [String], default: [] },
    language: { type: String, default: 'en' },
    totalCopies: { type: Number, default: 0 },
    availableCopies: { type: Number, default: 0 },
    issuedCopies: { type: Number, default: 0 },
    lostCopies: { type: Number, default: 0 },
    location: { type: String, default: '' },
    pricePerCopy: { type: Number, default: 0 },
    description: String,
    coverUrl: String,
  },
  { timestamps: true },
);
export type BookDoc = InferSchemaType<typeof bookSchema>;
export const BookModel = model('Book', bookSchema);

const copySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
    copyNumber: { type: Number, default: 1 },
    barcode: { type: String, default: '' },
    condition: { type: String, default: 'good' },
    status: { type: String, enum: ['available', 'issued', 'lost', 'damaged'], default: 'available' },
    currentHolderId: String,
    currentHolderName: String,
  },
  { timestamps: true },
);
export type CopyDoc = InferSchemaType<typeof copySchema>;
export const BookCopyModel = model('BookCopy', copySchema);

const memberSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    type: { type: String, enum: ['student', 'staff'], default: 'student' },
    name: { type: String, required: true },
    photoUrl: String,
    classOrDesignation: { type: String, default: '' },
    currentIssued: { type: Number, default: 0 },
    overdueCount: { type: Number, default: 0 },
    totalFinesPaid: { type: Number, default: 0 },
    outstandingFine: { type: Number, default: 0 },
    memberSince: { type: String, default: '' },
    blocked: { type: Boolean, default: false },
    maxBooksAllowed: { type: Number, default: 3 },
  },
  { timestamps: true },
);
export type MemberDoc = InferSchemaType<typeof memberSchema>;
export const LibraryMemberModel = model('LibraryMember', memberSchema);

const issueSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', index: true },
    bookTitle: String,
    copyId: { type: Schema.Types.ObjectId, ref: 'BookCopy' },
    barcode: String,
    memberId: { type: Schema.Types.ObjectId, ref: 'LibraryMember', index: true },
    memberName: String,
    memberType: { type: String, default: 'student' },
    memberClassOrDesignation: String,
    issueDate: String,
    dueDate: String,
    returnDate: String,
    status: { type: String, enum: ['active', 'returned', 'overdue'], default: 'active' },
    fineAmount: { type: Number, default: 0 },
    fineStatus: { type: String, enum: ['pending', 'paid', 'waived'], default: 'pending' },
    fineWaivedReason: String,
    conditionOnReturn: String,
    remarks: String,
  },
  { timestamps: true },
);
export type IssueDoc = InferSchemaType<typeof issueSchema>;
export const IssueModel = model('LibraryIssue', issueSchema);
