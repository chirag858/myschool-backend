import { z } from 'zod';

import { GPS_DEVICE_STATUSES, SIM_PROVIDERS } from './transport-tracking.models';

export const idParam = z.object({ id: z.string().min(1) });

export const addMaintenanceSchema = z.object({
  date: z.string().min(1),
  issueDescription: z.string().default(''),
  repairDone: z.string().default(''),
  cost: z.number().default(0),
  vendor: z.string().default(''),
  nextServiceDate: z.string().optional(),
  addedBy: z.string().default('System'),
});

export const saveGpsDeviceSchema = z.object({
  id: z.string().optional(),
  vehicleId: z.string().min(1),
  vehicleNumber: z.string().default(''),
  vehicleType: z.string().default('bus'),
  routeAssigned: z.string().optional(),
  imei: z.string().default(''),
  simNumber: z.string().default(''),
  simProvider: z.enum(SIM_PROVIDERS),
  simExpiry: z.string().default(''),
  deviceModel: z.string().default(''),
  installationDate: z.string().default(''),
  installedBy: z.string().default(''),
  serverEndpoint: z.string().default(''),
  status: z.enum(GPS_DEVICE_STATUSES),
  lastSignalAt: z.string().optional(),
  notes: z.string().optional(),
});
