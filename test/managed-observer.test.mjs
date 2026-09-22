import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedObserver } from '../src/managed/index.mjs';

test('managed observer accepts only HTTP targets', () => {
  assert.throws(
    () => createManagedObserver({ url: 'file:///etc/passwd' }),
    /must use http or https/
  );
});

test('managed observer requires its target origin in the request allowlist', () => {
  assert.throws(
    () => createManagedObserver({
      url: 'https://example.com/workload',
      allowedOrigins: ['https://other.example']
    }),
    /must include the managed target origin/
  );
});
