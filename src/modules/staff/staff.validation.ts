import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const staffQuery = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  department: z.string().optional(),
  employmentType: z.string().optional(),
  status: z.string().optional(),
  designation: z.string().optional(),
  search: z.string().optional(),
});

const salaryAdjustment = z.object({
  id: z.string().optional(),
  type: z.string(),
  customLabel: z.string().optional(),
  amount: z.coerce.number(),
  taxable: z.boolean().optional(),
  recurring: z.boolean().optional(),
});

export const createStaffSchema = z
  .object({
    name: z.string().min(1),
    mobile: z.string().optional(),
    joiningDate: z.string().optional(),
    basic: z.coerce.number().optional(),
    allowances: z.array(salaryAdjustment).optional(),
    deductions: z.array(salaryAdjustment).optional(),
    paymentMode: z.enum(['cash', 'bank', 'cheque']).optional(),
    bankAccountNumber: z.string().optional(),
    bankName: z.string().optional(),
    branch: z.string().optional(),
    ifsc: z.string().optional(),
  })
  .passthrough();

export const statusSchema = z.object({ status: z.string().min(1) });

const attendanceEntry = z.object({
  staffId: z.string().min(1),
  status: z.enum(['present', 'absent', 'leave', 'half_day', 'late']),
  timeIn: z.string().optional(),
  timeOut: z.string().optional(),
  remarks: z.string().optional(),
});
export const saveAttendanceSchema = z.object({
  date: z.string().min(1),
  attendance: z.array(attendanceEntry),
});
export const lockSchema = z.object({ date: z.string().min(1) });
