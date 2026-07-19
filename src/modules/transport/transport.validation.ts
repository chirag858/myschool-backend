import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const createVehicleSchema = z.object({ registrationNumber: z.string().min(1) }).passthrough();
export const updateVehicleSchema = z.object({}).passthrough();
export const statusSchema = z.object({ status: z.string().min(1) });

export const createDriverSchema = z.object({ name: z.string().min(1) }).passthrough();
export const updateDriverSchema = z.object({}).passthrough();

export const upsertRouteSchema = z.object({ routeName: z.string().min(1) }).passthrough();

export const assignSchema = z.object({ studentId: z.string().min(1) }).passthrough();
