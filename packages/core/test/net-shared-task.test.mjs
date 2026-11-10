import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedTask } from '@edgewarn/web-utils/net';

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

test('SharedTask cancels only after the final subscriber leaves and rejects abandoned joins promptly', async () => {
    let taskSignal;
    const task = new SharedTask((signal) => {
        taskSignal = signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const a = new AbortController(),
        b = new AbortController();
    const one = task.join(a.signal),
        two = task.join(b.signal);
    await turn();
    a.abort();
    await assert.rejects(one, { name: 'AbortError' });
    assert.equal(taskSignal.aborted, false);
    b.abort();
    await assert.rejects(two, { name: 'AbortError' });
    assert.equal(taskSignal.aborted, true);
    assert.equal(task.available, false);
});

test('SharedTask shares one load between subscribers and never aborts a settled task', async () => {
    let loads = 0;
    const task = new SharedTask(async () => ++loads);
    const a = new AbortController();
    assert.deepEqual(await Promise.all([task.join(a.signal), task.join(new AbortController().signal)]), [1, 1]);
    assert.equal(loads, 1);
    assert.equal(task.available, true);
});

test('SharedTask rejects a join with an already aborted signal', async () => {
    const task = new SharedTask(async () => 1);
    const controller = new AbortController();
    controller.abort();
    assert.throws(() => task.join(controller.signal), { name: 'AbortError' });
});
