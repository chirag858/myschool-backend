import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const upsertItemSchema = z.object({ name: z.string().min(1) }).passthrough();
export const upsertVendorSchema = z.object({ name: z.string().min(1) }).passthrough();
export const upsertAssetSchema = z.object({ name: z.string().min(1) }).passthrough();

const lineItem = z.object({ itemId: z.string(), itemName: z.string().optional(), quantity: z.number() }).passthrough();

export const purchaseSchema = z.object({ items: z.array(lineItem).min(1) }).passthrough();
export const issueSchema = z.object({ items: z.array(lineItem).min(1) }).passthrough();
