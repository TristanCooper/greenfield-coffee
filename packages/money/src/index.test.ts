import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@greenfield/money', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@greenfield/money');
  });
});
