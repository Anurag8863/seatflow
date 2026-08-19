import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().min(1, 'An id is required'),
});

/** Treats empty strings from query params as "not provided". */
export const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * An optional query param constrained to a set of literals. `U` is inferred as
 * the union of the literal members (the same trick zod's own `z.enum` uses), so
 * the parsed value is typed as that union rather than a bare `string`.
 */
export function optionalEnum<U extends string, T extends readonly [U, ...U[]]>(values: T) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .refine((value) => value === undefined || (values as readonly string[]).includes(value), {
      message: 'Must be one of: ' + values.join(', '),
    })
    .transform((value) => value as U | undefined);
}

export const sortDirSchema = z.enum(['asc', 'desc']).default('asc');
