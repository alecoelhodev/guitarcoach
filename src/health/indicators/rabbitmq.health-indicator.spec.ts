import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { ChannelModel } from 'amqplib';
import { RabbitmqHealthIndicator } from './rabbitmq.health-indicator';

describe('RabbitmqHealthIndicator', () => {
  let indicator: RabbitmqHealthIndicator;
  let mockConnection: { close: jest.Mock };
  let connect: jest.Mock;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    mockConnection = { close: jest.fn().mockResolvedValue(undefined) };
    connect = jest.fn().mockResolvedValue(mockConnection);
    configService = {
      get: jest.fn().mockReturnValue('amqp://localhost:5672'),
    };

    // Overrides the protected connect seam so the fake connection can be
    // asserted on directly, without module-mocking `amqplib`.
    class TestableRabbitmqHealthIndicator extends RabbitmqHealthIndicator {
      protected connect(url: string): Promise<ChannelModel> {
        return connect(url) as Promise<ChannelModel>;
      }
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestableRabbitmqHealthIndicator,
        HealthIndicatorService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    indicator = module.get(TestableRabbitmqHealthIndicator);
  });

  describe('pingCheck', () => {
    it('reports up and closes the connection when RabbitMQ is reachable', async () => {
      await expect(indicator.pingCheck('rabbitmq')).resolves.toEqual({
        rabbitmq: { status: 'up' },
      });

      expect(connect).toHaveBeenCalledWith('amqp://localhost:5672');
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('reports down without leaking connection details when RabbitMQ is unreachable', async () => {
      connect.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:5672'),
      );

      const result = await indicator.pingCheck('rabbitmq');

      expect(result).toEqual({
        rabbitmq: { status: 'down', message: 'unreachable' },
      });
      expect(mockConnection.close).not.toHaveBeenCalled();
    });
  });
});
