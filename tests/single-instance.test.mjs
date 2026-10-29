import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import instances from '../single-instance.js';

test('a second launcher process exits rather than opening another note store', () => {
  const app = new EventEmitter();
  let quit = false;
  app.requestSingleInstanceLock = () => false;
  app.quit = () => { quit = true; };
  assert.equal(instances.claimInstance(app, () => null), false);
  assert.equal(quit, true);
  assert.equal(app.listenerCount('second-instance'), 0);
});

test('a launcher click restores and focuses the running canvas', () => {
  const app = new EventEmitter(), calls = [];
  app.requestSingleInstanceLock = () => true;
  const window = { isMinimized: () => true, restore: () => calls.push('restore'),
    show: () => calls.push('show'), focus: () => calls.push('focus') };
  assert.equal(instances.claimInstance(app, () => window), true);
  app.emit('second-instance');
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});
