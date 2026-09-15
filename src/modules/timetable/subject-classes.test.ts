import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier: username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * A subject can belong to the whole school or to named classes only. The app's
 * subject form now writes `applicableClasses`, so this pins what the class's
 * own subject list (Subject assignment) does with it.
 */
describe('Subjects scoped to chosen classes', () => {
  let admin: string;
  let classes: Array<{ id: string; name: string }>;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
    classes = (await request(app).get('/api/classes').set(auth(admin))).body as Array<{ id: string; name: string }>;
  });

  const subjectsFor = async (classId: string, section: string): Promise<string[]> => {
    const res = await request(app).get('/api/timetable/subject-assignments').query({ classId, section }).set(auth(admin));
    expect(res.status).toBe(200);
    return (res.body as Array<{ subjectName: string }>).map((r) => r.subjectName);
  };

  it('a class-scoped subject appears for that class only; an all-classes one appears everywhere', async () => {
    const [first, second] = classes;
    const sections = (await request(app).get(`/api/classes/${first!.id}/sections`).set(auth(admin))).body as Array<{ name: string }>;
    const section = sections[0]!.name;
    const otherSections = (await request(app).get(`/api/classes/${second!.id}/sections`).set(auth(admin))).body as Array<{ name: string }>;

    const scoped = await request(app).post('/api/timetable/config/subjects').set(auth(admin)).send({
      name: 'Clay Modelling', code: 'CLAY', type: 'activity',
      applicableClasses: [first!.id], maxWeeklyPeriods: 2, color: '#10B981',
    });
    expect(scoped.status).toBe(201);
    expect(scoped.body.applicableClasses).toEqual([first!.id]);

    await request(app).post('/api/timetable/config/subjects').set(auth(admin)).send({
      name: 'General Knowledge', code: 'GK', type: 'core',
      applicableClasses: 'all', maxWeeklyPeriods: 1, color: '#6366F1',
    });

    const mine = await subjectsFor(first!.id, section);
    expect(mine).toContain('Clay Modelling');
    expect(mine).toContain('General Knowledge');

    const theirs = await subjectsFor(second!.id, otherSections[0]!.name);
    expect(theirs).not.toContain('Clay Modelling');
    expect(theirs).toContain('General Knowledge');
  });

  it('editing the class list moves the subject between classes', async () => {
    const [first, second] = classes;
    const sectionOf = async (id: string): Promise<string> =>
      ((await request(app).get(`/api/classes/${id}/sections`).set(auth(admin))).body as Array<{ name: string }>)[0]!.name;

    const created = await request(app).post('/api/timetable/config/subjects').set(auth(admin)).send({
      name: 'Robotics', code: 'ROB', type: 'elective',
      applicableClasses: [first!.id], maxWeeklyPeriods: 2, color: '#F59E0B',
    });

    const moved = await request(app).put(`/api/timetable/config/subjects/${created.body.id}`).set(auth(admin))
      .send({ applicableClasses: [second!.id] });
    expect(moved.status).toBe(200);

    expect(await subjectsFor(first!.id, await sectionOf(first!.id))).not.toContain('Robotics');
    expect(await subjectsFor(second!.id, await sectionOf(second!.id))).toContain('Robotics');
  });

  it('a teacher cannot create subjects (editGate is academic admins only)', async () => {
    const teacher = await token('teacher');
    const res = await request(app).post('/api/timetable/config/subjects').set(auth(teacher)).send({
      name: 'Nope', code: 'NOPE', type: 'core', applicableClasses: 'all', maxWeeklyPeriods: 1, color: '#111111',
    });
    expect(res.status).toBe(403);
  });
});
