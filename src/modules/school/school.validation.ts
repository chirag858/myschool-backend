import { z } from 'zod';

import {
  AFFILIATED_BOARDS,
  PAYMENT_METHODS,
  SCHOOL_STATUSES,
  SCHOOL_TYPES,
  SUBSCRIPTION_PLANS,
} from './school.model';

export const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
});

export const generateCodeQuerySchema = z.object({
  name: z.string().min(1),
});

export const codeCheckQuerySchema = z.object({
  code: z.string().min(1),
});

export const schoolsQuerySchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  status: z.enum([...SCHOOL_STATUSES, 'all']).optional(),
  plan: z.enum([...SUBSCRIPTION_PLANS, 'all']).optional(),
  search: z.string().optional(),
});

export const createSchoolSchema = z.object({
  identity: z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    type: z.enum(SCHOOL_TYPES),
    board: z.enum(AFFILIATED_BOARDS),
    addressLine1: z.string().min(1),
    addressLine2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    pinCode: z.string().min(1),
    contactMobile: z.string().min(1),
    contactEmail: z.string().email(),
    principalName: z.string().min(1),
    establishedYear: z.coerce.number(),
  }),
  branding: z.object({
    logoFileName: z.string().optional(),
    signatureFileName: z.string().optional(),
    stampFileName: z.string().optional(),
    headerText: z.string().optional(),
    footerText: z.string().optional(),
    primaryColor: z.string().optional(),
  }),
  subscription: z.object({
    plan: z.enum(SUBSCRIPTION_PLANS),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    graceDays: z.coerce.number(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    paymentReference: z.string(),
    amountPaid: z.coerce.number(),
    notes: z.string().optional(),
  }),
});

export const statusSchema = z.object({
  status: z.enum(SCHOOL_STATUSES),
  reason: z.string().optional(),
});

// Full or partial Record<ModuleKey, boolean>; unknown keys are dropped in the service.
export const modulesSchema = z.record(z.string(), z.boolean());
