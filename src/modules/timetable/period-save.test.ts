import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier: username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

type PeriodRow = { id: string; order: number; name: string; startTime: string; endTime: string; type: string; applicableDays: unknown };

/**
 * Saving the period list used to delete every period and re-insert it, so each
 * save minted new ids and orphaned every timetable slot (slots store
 * `periodId`). These pin the fixed behaviour: edits keep ids and slots,
 * additions get new ids, and only a DELETED period takes its slots with it.
 */
describe('Period save keeps the timetable attached', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('principal');
  });

  const getPeriods = async (): Promise<PeriodRow[]> =>
    (await request(app).get('/api/timetable/config/periods').set(auth(admin))).body as PeriodRow[];
  const save = (periods: unknown[]) =>
    request(app).post('/api/timetable/config/periods/save').set(auth(admin)).send({ periods });

  /** A real slot on `periodId` for the first class/section, via the real save route. */
  async function fillSlot(periodId: string): Promise<{ classId: string; section: string }> {
    const cls = ((await request(app).get('/api/classes').set(auth(admin))).body as Array<{ id: string }>)[0]!;
    const section = ((await request(app).get(`/api/classes/${cls.id}/sections`).set(auth(admin))).body as Array<{ name: string }>)[0]!.name;
    const subject = await request(app).post('/api/timetable/config/subjects').set(auth(admin))
      .send({ name: 'Periodic Science', code: 'PSC', type: 'core', applicableClasses: 'all', maxWeeklyPeriods: 5, color: '#0EA5E9' });
    const room = await request(app).post('/api/timetable/config/rooms').set(auth(admin))
      .send({ name: 'Room P1', type: 'classroom', capacity: 40, floor: 'Ground', facilities: [], status: 'available' });
    const teacher = ((await request(app).get('/api/timetable/teachers').set(auth(admin))).body as Array<{ id: string; name: string }>)[0]!;
    const res = await request(app).post(`/api/timetable/${cls.id}/save`).set(auth(admin)).send({
      classId: cls.id, section, day: 'mon', periodId,
      subjectId: subject.body.id, subjectName: 'Periodic Science', subjectColor: '#0EA5E9',
      teacherId: teacher.id, teacherName: teacher.name, roomId: room.body.id, roomName: 'Room P1',
    });
    expect(res.status).toBe(200);
    return { classId: cls.id, section };
  }
  const slotsOf = async (classId: string, section: string): Promise<Array<{ periodId: string }>> =>
    ((await request(app).get(`/api/timetable/${classId}`).query({ section }).set(auth(admin))).body as { slots: Array<{ periodId: string }> }).slots;

  it('editing and reordering keeps period ids, so filled slots stay attached', async () => {
    await save([
      { order: 0, name: 'Period 1', startTime: '08:00', endTime: '08:40', type: 'class', applicableDays: 'all' },
      { order: 1, name: 'Period 2', startTime: '08:40', endTime: '09:20', type: 'class', applicableDays: 'all' },
    ]);
    const before = await getPeriods();
    const { classId, section } = await fillSlot(before[0]!.id);

    // Rename + retime the first, swap the order, add a brand-new third.
    const res = await save([
      { ...before[1]!, order: 0 },
      { ...before[0]!, order: 1, name: 'First Period', startTime: '08:05' },
      { order: 2, name: 'Break', startTime: '09:20', endTime: '09:35', type: 'break', applicableDays: 'all' },
    ]);
    expect(res.status).toBe(200);

    const after = await getPeriods();
    expect(after.map((p) => p.name)).toEqual(['Period 2', 'First Period', 'Break']);
    expect(after.find((p) => p.name === 'First Period')!.id).toBe(before[0]!.id);
    expect(after.find((p) => p.name === 'Period 2')!.id).toBe(before[1]!.id);
    expect(after.find((p) => p.name === 'Break')!.id).not.toBe(before[0]!.id);

    const slots = await slotsOf(classId, section);
    expect(slots.some((s) => s.periodId === before[0]!.id)).toBe(true);
  });

  it('deleting a period removes it and clears only its slots', async () => {
    await save([
      { order: 0, name: 'Keep', startTime: '08:00', endTime: '08:40', type: 'class', applicableDays: 'all' },
      { order: 1, name: 'Drop', startTime: '08:40', endTime: '09:20', type: 'class', applicableDays: 'all' },
    ]);
    const [keep, drop] = await getPeriods();
    const { classId, section } = await fillSlot(drop!.id);
    expect((await slotsOf(classId, section)).some((s) => s.periodId === drop!.id)).toBe(true);

    await save([{ ...keep! }]);

    const after = await getPeriods();
    expect(after.map((p) => p.id)).toEqual([keep!.id]);
    expect((await slotsOf(classId, section)).some((s) => s.periodId === drop!.id)).toBe(false);
  });

  it('an unknown client temp id is treated as a new period (web sends p_xxxx for new rows)', async () => {
    const res = await save([{ id: 'p_ab12cd', order: 0, name: 'Zero', startTime: '07:30', endTime: '08:00', type: 'assembly', applicableDays: 'all' }]);
    expect(res.status).toBe(200);
    const after = await getPeriods();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe('p_ab12cd');
    expect(after[0]).toMatchObject({ name: 'Zero', type: 'assembly' });
  });
});
