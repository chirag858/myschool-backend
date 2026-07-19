import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const upsertBuildingSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    type: z.string().optional(),
    floors: z.coerce.number().optional(),
    wardenName: z.string().optional(),
    wardenMobile: z.string().optional(),
    address: z.string().optional(),
    status: z.string().optional(),
    facilities: z.array(z.string()).optional(),
  })
  .passthrough();

export const upsertRoomSchema = z
  .object({
    id: z.string().optional(),
    buildingId: z.string().min(1),
    floorNumber: z.coerce.number().optional(),
    roomNumber: z.string().min(1),
    roomType: z.string().optional(),
    totalBeds: z.coerce.number().optional(),
    monthlyCharge: z.coerce.number().optional(),
    facilities: z.array(z.string()).optional(),
  })
  .passthrough();

export const allocateSchema = z
  .object({
    studentId: z.string().min(1),
    roomId: z.string().min(1),
    bedId: z.string().min(1),
    buildingId: z.string().optional(),
    monthlyFee: z.coerce.number().optional(),
  })
  .passthrough();

export const vacateSchema = z.object({
  vacateDate: z.string().min(1),
  reason: z.string().optional(),
  refundAmount: z.coerce.number().optional(),
});

export const addVisitorSchema = z
  .object({
    visitorName: z.string().min(1),
    relation: z.string().optional(),
    studentId: z.string().optional(),
    purpose: z.string().optional(),
    idProofType: z.string().optional(),
    idProofNumber: z.string().optional(),
    checkInTime: z.string().optional(),
  })
  .passthrough();
