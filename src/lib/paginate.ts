import type { FilterQuery, Model, PopulateOptions, SortOrder } from 'mongoose';

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Read page/pageSize from a raw query object with sane defaults + caps. */
export function pageParams(query: Record<string, unknown>): PageParams {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  { page, pageSize }: PageParams,
  opts: { sort?: Record<string, SortOrder>; populate?: PopulateOptions | PopulateOptions[] } = {},
): Promise<Page<T>> {
  const skip = (page - 1) * pageSize;
  const query = model
    .find(filter)
    .sort(opts.sort ?? { createdAt: -1 })
    .skip(skip)
    .limit(pageSize);
  if (opts.populate) query.populate(opts.populate);

  const [items, total] = await Promise.all([
    query.lean<T[]>().exec(),
    model.countDocuments(filter),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
}
