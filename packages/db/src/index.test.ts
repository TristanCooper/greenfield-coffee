import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, db } from './index.js';

describe('@greenfield/db', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@greenfield/db');
  });

  it('exports a typed db client', () => {
    // Structural smoke — `db` is the drizzle() wrapper. Don't hit the network
    // from a unit test; this just guards the export shape and the query API.
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
    expect(typeof db.execute).toBe('function');
  });
});
