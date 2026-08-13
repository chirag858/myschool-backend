import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const ticketsQuerySchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  priority: z.string().optional(),
  search: z.string().optional(),
});

export const createTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  stepsToReproduce: z.string().optional(),
});

export const statusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'testing', 'resolved', 'closed']),
});

export const assignSchema = z.object({
  assignedTo: z.string().min(1),
});

export const prioritySchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'critical']),
});

export const commentSchema = z.object({
  body: z.string().min(1),
  internal: z.boolean().default(false),
});
