import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Library API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/library/books')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/library/books').set(auth(acc))).status).toBe(403);
  });

  it('dashboard + activity return shapes', async () => {
    const kpi = await request(app).get('/api/library/dashboard').set(auth(admin));
    expect(kpi.status).toBe(200);
    expect(kpi.body).toMatchObject({ totalTitles: 3, totalCopies: 9, booksIssued: 0, pendingFine: 0 });
    const activity = await request(app).get('/api/library/activity').set(auth(admin));
    expect(Array.isArray(activity.body)).toBe(true);
  });

  it('books: list seeded, get, copies, create + edit + delete', async () => {
    const list = await request(app).get('/api/library/books').set(auth(admin));
    expect(list.body.length).toBe(3);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), title: expect.any(String), totalCopies: expect.any(Number) });

    const id = list.body[0].id;
    const copies = await request(app).get(`/api/library/books/${id}/copies`).set(auth(admin));
    expect(copies.body.length).toBeGreaterThan(0);
    expect(copies.body[0]).toMatchObject({ id: expect.any(String), barcode: expect.any(String), status: 'available' });

    const create = await request(app)
      .post('/api/library/books')
      .set(auth(admin))
      .send({ title: 'New Title', authors: ['X'], isbn: '111', totalCopies: 2, category: 'fiction' });
    expect(create.status).toBe(201);
    expect(create.body.availableCopies).toBe(2);
    const newCopies = await request(app).get(`/api/library/books/${create.body.id}/copies`).set(auth(admin));
    expect(newCopies.body.length).toBe(2);

    const edit = await request(app).post('/api/library/books').set(auth(admin)).send({ id: create.body.id, title: 'Edited', totalCopies: 2 });
    expect(edit.body.title).toBe('Edited');

    const del = await request(app).delete(`/api/library/books/${create.body.id}`).set(auth(admin));
    expect(del.body.success).toBe(true);
  });

  it('members: list seeded, get, toggle block', async () => {
    const list = await request(app).get('/api/library/members').set(auth(admin));
    expect(list.body.length).toBe(5);
    const id = list.body[0].id;
    const block = await request(app).patch(`/api/library/members/${id}/block`).set(auth(admin));
    expect(block.body.blocked).toBe(true);
    const unblock = await request(app).patch(`/api/library/members/${id}/block`).set(auth(admin));
    expect(unblock.body.blocked).toBe(false);
  });

  it('circulation: issue → book counts update → return restores', async () => {
    const books = await request(app).get('/api/library/books').set(auth(admin));
    const book = books.body[0];
    const copies = await request(app).get(`/api/library/books/${book.id}/copies`).set(auth(admin));
    const copy = copies.body.find((c: { status: string }) => c.status === 'available');
    const members = await request(app).get('/api/library/members').set(auth(admin));
    const member = members.body[0];

    const issue = await request(app)
      .post('/api/library/issue')
      .set(auth(admin))
      .send({ memberId: member.id, bookId: book.id, copyId: copy.id, dueDate: '2025-05-01' });
    expect(issue.status).toBe(201);
    expect(issue.body).toMatchObject({ status: 'active', memberName: member.name, bookTitle: book.title });

    const afterIssue = await request(app).get(`/api/library/books/${book.id}`).set(auth(admin));
    expect(afterIssue.body.availableCopies).toBe(book.availableCopies - 1);
    expect(afterIssue.body.issuedCopies).toBe(book.issuedCopies + 1);

    const kpi = await request(app).get('/api/library/dashboard').set(auth(admin));
    expect(kpi.body.booksIssued).toBe(1);

    const ret = await request(app)
      .post('/api/library/return')
      .set(auth(admin))
      .send({ issueId: issue.body.id, condition: 'good', fineAmount: 20, waived: false });
    expect(ret.body).toMatchObject({ status: 'returned', fineStatus: 'paid', fineAmount: 20 });

    const afterReturn = await request(app).get(`/api/library/books/${book.id}`).set(auth(admin));
    expect(afterReturn.body.availableCopies).toBe(book.availableCopies);
    expect(afterReturn.body.issuedCopies).toBe(book.issuedCopies);
  });

  it('rejects issuing an unavailable copy (409) and invalid payloads (400)', async () => {
    const books = await request(app).get('/api/library/books').set(auth(admin));
    const book = books.body[0];
    const copies = await request(app).get(`/api/library/books/${book.id}/copies`).set(auth(admin));
    const copy = copies.body[0];
    const members = await request(app).get('/api/library/members').set(auth(admin));
    const member = members.body[0];

    await request(app).post('/api/library/issue').set(auth(admin)).send({ memberId: member.id, bookId: book.id, copyId: copy.id, dueDate: '2025-05-01' });
    const again = await request(app).post('/api/library/issue').set(auth(admin)).send({ memberId: member.id, bookId: book.id, copyId: copy.id, dueDate: '2025-05-01' });
    expect(again.status).toBe(409);

    expect((await request(app).post('/api/library/issue').set(auth(admin)).send({ memberId: member.id })).status).toBe(400);
  });
});
