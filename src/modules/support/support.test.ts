import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      username,
      password: 'demo1234',
      captcha: 'x',
      ...(['superadmin', 'support'].includes(username) ? {} : { schoolCode: 'MSC' }),
    });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Support ticket API', () => {
  beforeEach(async () => {
    await seedDemo();
  });

  it('requires auth (401)', async () => {
    expect((await request(app).get('/api/support/kpi')).status).toBe(401);
  });

  it('avgResolutionHours is a sane number derived from seeded createdAt/resolvedAt, not a stray Mongoose auto-timestamp artifact', async () => {
    const t = await token('superadmin');
    const res = await request(app).get('/api/support/kpi').set(auth(t));
    expect(res.status).toBe(200);
    // Seeded ticket TKT-2026-004: createdAt 04:00, resolvedAt 10:00 → 6h.
    expect(res.body.avgResolutionHours).toBe(6);
  });

  it('avgResolutionHours still counts a ticket after it moves from resolved to closed', async () => {
    const raiser = await token('schooladmin');
    const create = await request(app)
      .post('/api/support/tickets')
      .set(auth(raiser))
      .send({ title: 'Closable', description: 'x', category: 'other', priority: 'low' });
    const id = create.body.id as string;
    const eng = await token('support');
    await request(app).patch(`/api/support/tickets/${id}/status`).set(auth(eng)).send({ status: 'resolved' });

    const before = await request(app).get('/api/support/kpi').set(auth(eng));
    await request(app).patch(`/api/support/tickets/${id}/status`).set(auth(eng)).send({ status: 'closed' });
    const after = await request(app).get('/api/support/kpi').set(auth(eng));

    // Closing shouldn't drop the ticket out of the average — same sample
    // size either way (this ticket resolved instantly, contributing ~0h,
    // so the aggregate average shouldn't jump after closing it).
    expect(after.body.avgResolutionHours).toBe(before.body.avgResolutionHours);
  });

  it('allows every staff role SupportDashboardPage is built for, not just super_admin/support_engineer', async () => {
    const roles = [
      'schooladmin',
      'principal',
      'superadmin',
      'support',
      'receptionist',
      'coordinator',
      'teacher',
      'accountant',
    ];
    for (const username of roles) {
      const t = await token(username);
      const res = await request(app).get('/api/support/kpi').set(auth(t));
      expect(res.status, `${username} should reach /support/kpi`).toBe(200);
    }
  });

  it('createTicket derives reporterName/reporterRole/schoolName server-side, ignoring any client-supplied identity', async () => {
    const t = await token('receptionist');
    const res = await request(app)
      .post('/api/support/tickets')
      .set(auth(t))
      .send({
        title: 'Printer not working',
        description: 'Front desk printer offline',
        category: 'hardware',
        priority: 'low',
        // Spoofed identity fields a malicious/stale client might still send —
        // must be ignored, not trusted.
        reporterName: 'Fake Name',
        reporterRole: 'Super Admin',
        schoolName: 'Someone Else School',
      });
    expect(res.status).toBe(201);
    expect(res.body.reporterName).toBe('Receptionist');
    expect(res.body.reporterName).not.toBe('Fake Name');
    expect(res.body.reporterRole).toBe('Receptionist');
    expect(res.body.reporterRole).not.toBe('Super Admin');
    expect(res.body.schoolName).not.toBe('Someone Else School');
    expect(res.body.ticketNumber).toMatch(/^TKT-\d{4}-\d{3}$/);
  });

  it('addComment derives authorName/authorRole server-side, ignoring any client-supplied identity', async () => {
    const raiser = await token('teacher');
    const create = await request(app)
      .post('/api/support/tickets')
      .set(auth(raiser))
      .send({ title: 'Bug', description: 'Something broke', category: 'technical_bug', priority: 'medium' });
    const ticketId = create.body.id as string;

    const commenter = await token('support');
    const comment = await request(app)
      .post(`/api/support/tickets/${ticketId}/comments`)
      .set(auth(commenter))
      .send({ body: 'Looking into it', internal: false, authorName: 'Spoofed', authorRole: 'Fake Role' });
    expect(comment.status).toBe(201);
    expect(comment.body.authorName).toBe('Support Engineer');
    expect(comment.body.authorName).not.toBe('Spoofed');
  });

  it('changePriority actually changes priority (not a re-assign no-op)', async () => {
    const raiser = await token('schooladmin');
    const create = await request(app)
      .post('/api/support/tickets')
      .set(auth(raiser))
      .send({ title: 'Slow app', description: 'Loading is slow', category: 'performance', priority: 'low' });
    const ticketId = create.body.id as string;

    const eng = await token('support');
    const changed = await request(app)
      .patch(`/api/support/tickets/${ticketId}/priority`)
      .set(auth(eng))
      .send({ priority: 'critical' });
    expect(changed.status).toBe(200);
    expect(changed.body.priority).toBe('critical');
    expect(changed.body.assignedTo).toBe('Unassigned');
  });

  describe('ticket lifecycle locking (resolved/closed are terminal)', () => {
    async function raiseTicket(): Promise<string> {
      const raiser = await token('schooladmin');
      const create = await request(app)
        .post('/api/support/tickets')
        .set(auth(raiser))
        .send({ title: 'Lifecycle test', description: 'x', category: 'other', priority: 'low' });
      return create.body.id as string;
    }

    it('rejects re-setting the same status (no more resolved→resolved / closed→closed noise)', async () => {
      const id = await raiseTicket();
      const eng = await token('support');
      await request(app).patch(`/api/support/tickets/${id}/status`).set(auth(eng)).send({ status: 'resolved' });
      const again = await request(app)
        .patch(`/api/support/tickets/${id}/status`)
        .set(auth(eng))
        .send({ status: 'resolved' });
      expect(again.status).toBe(400);
    });

    it('closed ticket only accepts a reopen (→ in_progress); priority/assign are locked', async () => {
      const id = await raiseTicket();
      const eng = await token('support');
      await request(app).patch(`/api/support/tickets/${id}/status`).set(auth(eng)).send({ status: 'closed' });

      const badStatus = await request(app)
        .patch(`/api/support/tickets/${id}/status`)
        .set(auth(eng))
        .send({ status: 'open' });
      expect(badStatus.status).toBe(400);

      const badPriority = await request(app)
        .patch(`/api/support/tickets/${id}/priority`)
        .set(auth(eng))
        .send({ priority: 'critical' });
      expect(badPriority.status).toBe(400);

      const badAssign = await request(app)
        .patch(`/api/support/tickets/${id}/assign`)
        .set(auth(eng))
        .send({ assignedTo: 'Support Engineer 1' });
      expect(badAssign.status).toBe(400);

      const reopen = await request(app)
        .patch(`/api/support/tickets/${id}/status`)
        .set(auth(eng))
        .send({ status: 'in_progress' });
      expect(reopen.status).toBe(200);
      expect(reopen.body.status).toBe('in_progress');

      // once reopened, normal mutations work again
      const priorityAfterReopen = await request(app)
        .patch(`/api/support/tickets/${id}/priority`)
        .set(auth(eng))
        .send({ priority: 'high' });
      expect(priorityAfterReopen.status).toBe(200);
    });

    it('resolved ticket accepts close or reopen, nothing else', async () => {
      const id = await raiseTicket();
      const eng = await token('support');
      await request(app).patch(`/api/support/tickets/${id}/status`).set(auth(eng)).send({ status: 'resolved' });

      const badStatus = await request(app)
        .patch(`/api/support/tickets/${id}/status`)
        .set(auth(eng))
        .send({ status: 'testing' });
      expect(badStatus.status).toBe(400);

      const close = await request(app)
        .patch(`/api/support/tickets/${id}/status`)
        .set(auth(eng))
        .send({ status: 'closed' });
      expect(close.status).toBe(200);
      expect(close.body.status).toBe('closed');
    });
  });
});
