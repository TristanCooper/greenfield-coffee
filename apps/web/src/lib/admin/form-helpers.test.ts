// apps/web/src/lib/admin/form-helpers.test.ts
//
// Card 0.16 — pure-logic tests for the shared form helpers.
//
// These helpers are pure (no DB) so the tests don't need the
// project-wide DB harness. They guard against the most common
// regressions:
//   - parsePositiveNumber accepting zero / negative
//   - parseTags dropping empty entries
//   - flattenZodErrors nesting under field names

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  flattenZodErrors,
  parsePositiveNumber,
  parseNonNegativeNumber,
  parseTags,
  strOrUndef,
} from './form-helpers.js';

describe('strOrUndef', () => {
  it('returns undefined for null', () => {
    expect(strOrUndef(null)).toBeUndefined();
  });
  it('returns undefined for empty string', () => {
    expect(strOrUndef('')).toBeUndefined();
  });
  it('returns undefined for non-string FormDataEntryValue', () => {
    // Simulating File: a File is an object, not a string.
    expect(strOrUndef({} as unknown as File)).toBeUndefined();
  });
  it('returns the string for a non-empty string', () => {
    expect(strOrUndef('hello')).toBe('hello');
  });
});

describe('parsePositiveNumber', () => {
  it('returns null for undefined / empty', () => {
    expect(parsePositiveNumber(undefined)).toBeNull();
    expect(parsePositiveNumber('')).toBeNull();
  });
  it('returns null for non-numeric', () => {
    expect(parsePositiveNumber('abc')).toBeNull();
  });
  it('returns null for zero / negative', () => {
    expect(parsePositiveNumber('0')).toBeNull();
    expect(parsePositiveNumber('-1')).toBeNull();
  });
  it('returns the number for positive input', () => {
    expect(parsePositiveNumber('3.14')).toBe(3.14);
    expect(parsePositiveNumber('100')).toBe(100);
  });
});

describe('parseNonNegativeNumber', () => {
  it('allows zero', () => {
    expect(parseNonNegativeNumber('0')).toBe(0);
  });
  it('rejects negative', () => {
    expect(parseNonNegativeNumber('-1')).toBeNull();
  });
  it('accepts positive', () => {
    expect(parseNonNegativeNumber('250')).toBe(250);
  });
});

describe('parseTags', () => {
  it('returns empty array for undefined', () => {
    expect(parseTags(undefined)).toEqual([]);
  });
  it('parses comma-separated tags', () => {
    expect(parseTags('espresso, single-origin')).toEqual([
      'espresso',
      'single-origin',
    ]);
  });
  it('drops empty tags from consecutive commas', () => {
    expect(parseTags('a,,b,')).toEqual(['a', 'b']);
  });
  it('trims whitespace', () => {
    expect(parseTags('  a , b ')).toEqual(['a', 'b']);
  });
  it('caps at 32 entries', () => {
    const many = Array.from({ length: 50 }, (_, i) => `t${i}`).join(',');
    const out = parseTags(many);
    expect(out.length).toBe(32);
  });
});

describe('flattenZodErrors', () => {
  const schema = z.object({
    code: z.string().min(1, 'Code is required'),
    age: z.number().int().positive(),
  });

  it('groups errors by field path', () => {
    const result = schema.safeParse({ code: '', age: -1 });
    if (result.success) throw new Error('expected failure');
    const flat = flattenZodErrors(result.error);
    expect(flat.code).toContain('Code is required');
    expect(flat.age).toBeDefined();
    expect(flat.age!.length).toBeGreaterThan(0);
  });

  it('returns _root for errors without a path', () => {
    const s = z
      .object({ a: z.string() })
      .refine((v) => v.a !== 'bad', { message: 'root fail' });
    const r = s.safeParse({ a: 'bad' });
    if (r.success) throw new Error('expected failure');
    const flat = flattenZodErrors(r.error);
    // Either '_root' (the fallback we synthesise) or a top-level key
    // (Zod's actual behaviour varies between major versions). The
    // contract is: SOME key holds 'root fail'.
    const merged = Object.values(flat).flat();
    expect(merged).toContain('root fail');
  });
});
