import { Logger } from '@nestjs/common';
import { meters } from '../observability/metrics/meters';
import { recordQueryDuration } from './prisma.service';

describe('recordQueryDuration', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records the query duration labeled by model and action only', async () => {
    const recordSpy = jest.spyOn(meters.dbQueryDurationMs, 'record');
    const query = jest.fn().mockResolvedValue({ id: 'task-1' });

    const result = await recordQueryDuration({
      model: 'Task',
      operation: 'findMany',
      args: { where: { userId: 'user-1', title: 'secret routine name' } },
      query,
    });

    expect(result).toEqual({ id: 'task-1' });
    expect(query).toHaveBeenCalledWith({
      where: { userId: 'user-1', title: 'secret routine name' },
    });
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const [durationMs, attributes] = recordSpy.mock.calls[0];
    expect(typeof durationMs).toBe('number');
    expect(attributes).toEqual({ model: 'Task', action: 'findMany' });
    // Never leak query args/where values as metric attributes/labels.
    expect(JSON.stringify(attributes)).not.toContain('user-1');
    expect(JSON.stringify(attributes)).not.toContain('secret routine name');
  });

  it('records the duration and rethrows when the underlying query fails', async () => {
    const recordSpy = jest.spyOn(meters.dbQueryDurationMs, 'record');
    const failure = new Error('connection refused');
    const query = jest.fn().mockRejectedValue(failure);

    await expect(
      recordQueryDuration({
        model: 'Routine',
        operation: 'create',
        args: {},
        query,
      }),
    ).rejects.toThrow('connection refused');

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0][1]).toEqual({
      model: 'Routine',
      action: 'create',
    });
  });

  it('warn-logs a slow query once the threshold is exceeded', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const nowSpy = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000 + 600); // 600ms > the 500ms threshold
    const query = jest.fn().mockResolvedValue(undefined);

    await recordQueryDuration({
      model: 'Task',
      operation: 'findMany',
      args: {},
      query,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Task.findMany');
    nowSpy.mockRestore();
  });

  it('does not warn-log a query under the threshold', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const nowSpy = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000 + 100); // 100ms < the 500ms threshold
    const query = jest.fn().mockResolvedValue(undefined);

    await recordQueryDuration({
      model: 'Task',
      operation: 'findMany',
      args: {},
      query,
    });

    expect(warnSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});
