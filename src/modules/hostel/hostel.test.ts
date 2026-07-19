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

describe('Hostel API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/hostel/buildings')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/hostel/buildings').set(auth(acc))).status).toBe(403);
  });

  it('dashboard + buildings with derived room counts', async () => {
    const kpi = await request(app).get('/api/hostel/dashboard').set(auth(admin));
    expect(kpi.status).toBe(200);
    expect(kpi.body).toMatchObject({ totalRooms: 2, occupiedBeds: 1, totalStudents: 1, pendingFee: 3000 });

    const buildings = await request(app).get('/api/hostel/buildings').set(auth(admin));
    expect(buildings.body.length).toBe(1);
    expect(buildings.body[0]).toMatchObject({ id: expect.any(String), name: 'Boys Hostel A', totalRooms: 2 });
  });

  it('rooms: list seeded, get, create with generated beds', async () => {
    const list = await request(app).get('/api/hostel/rooms').set(auth(admin));
    expect(list.body.length).toBe(2);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), roomNumber: expect.any(String), totalBeds: 2, beds: expect.any(Array) });

    const buildingId = (await request(app).get('/api/hostel/buildings').set(auth(admin))).body[0].id;
    const create = await request(app)
      .post('/api/hostel/rooms')
      .set(auth(admin))
      .send({ buildingId, roomNumber: '201', floorNumber: 2, roomType: 'triple', totalBeds: 3, monthlyCharge: 3500 });
    expect(create.status).toBe(201);
    expect(create.body.beds.length).toBe(3);
    expect(create.body.status).toBe('available');
  });

  it('allocates a student to a bed and updates room occupancy', async () => {
    const rooms = await request(app).get('/api/hostel/rooms').set(auth(admin));
    const room = rooms.body.find((r: { roomNumber: string }) => r.roomNumber === '102');
    const bed = room.beds.find((b: { status: string }) => b.status === 'empty');
    const students = await request(app).get('/api/students?classKey=Class 2').set(auth(admin));
    const student = students.body.rows[0];

    const alloc = await request(app)
      .post('/api/hostel/students/allocate')
      .set(auth(admin))
      .send({ studentId: student.id, studentName: student.name, className: student.className, roomId: room.id, bedId: bed.id, monthlyFee: 3000 });
    expect(alloc.status).toBe(201);
    expect(alloc.body).toMatchObject({ status: 'allocated', roomNumber: '102', bedNumber: bed.bedNumber });

    const afterRoom = await request(app).get(`/api/hostel/rooms/${room.id}`).set(auth(admin));
    expect(afterRoom.body.occupiedBeds).toBe(1);
    expect(afterRoom.body.status).toBe('partial');

    // Duplicate bed allocation → 409
    const again = await request(app)
      .post('/api/hostel/students/allocate')
      .set(auth(admin))
      .send({ studentId: student.id, roomId: room.id, bedId: bed.id });
    expect(again.status).toBe(409);
  });

  it('vacates a student and frees the bed', async () => {
    const list = await request(app).get('/api/hostel/students').set(auth(admin));
    expect(list.body.length).toBe(1);
    const allocation = list.body[0];
    const roomId = allocation.roomId;

    const vac = await request(app)
      .post(`/api/hostel/students/${allocation.id}/vacate`)
      .set(auth(admin))
      .send({ vacateDate: '2025-06-01', reason: 'Left', refundAmount: 0 });
    expect(vac.body.success).toBe(true);

    const room = await request(app).get(`/api/hostel/rooms/${roomId}`).set(auth(admin));
    expect(room.body.occupiedBeds).toBe(0);
    expect(room.body.status).toBe('available');
  });

  it('fee rows + visitors (add/checkout)', async () => {
    const fee = await request(app).get('/api/hostel/fee').set(auth(admin));
    expect(fee.body.length).toBe(1);
    expect(fee.body[0]).toMatchObject({ studentName: expect.any(String), monthlyFee: 3000, amountDue: 3000, status: 'pending' });

    const add = await request(app)
      .post('/api/hostel/visitors')
      .set(auth(admin))
      .send({ visitorName: 'Uncle Ram', relation: 'uncle', purpose: 'Meeting', idProofType: 'aadhaar', idProofNumber: '1234' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ visitorName: 'Uncle Ram', checkInTime: expect.any(String) });
    expect(add.body.checkOutTime).toBeFalsy();

    const out = await request(app).patch(`/api/hostel/visitors/${add.body.id}/checkout`).set(auth(admin));
    expect(out.body.checkOutTime).toEqual(expect.any(String));
  });

  it('GET /students/:id/hostel returns the allocation', async () => {
    const list = await request(app).get('/api/hostel/students').set(auth(admin));
    const studentId = list.body[0].studentId;
    const res = await request(app).get(`/api/students/${studentId}/hostel`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ building: 'Boys Hostel A', roomNumber: '101', monthlyFee: 3000 });
  });
});
