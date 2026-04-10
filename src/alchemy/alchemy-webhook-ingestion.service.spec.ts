import { PrismaService } from '../prisma.service';
import { AivenKafkaService } from '../kafka/aiven-kafka.service';
import { AlchemyWebhookIngestionService } from './alchemy-webhook-ingestion.service';
import { AlchemyWebhookNormalizerService } from './alchemy-webhook-normalizer.service';

describe('AlchemyWebhookIngestionService', () => {
  const normalizerService = {
    normalize: jest.fn(),
  };
  const kafkaService = {
    publish: jest.fn(),
  };
  const prismaService = {
    webhookEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  let service: AlchemyWebhookIngestionService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaService.webhookEvent.create.mockResolvedValue({
      id: 'db_event_1',
    });
    kafkaService.publish.mockResolvedValue(undefined);

    service = new AlchemyWebhookIngestionService(
      prismaService as unknown as PrismaService,
      kafkaService as unknown as AivenKafkaService,
      normalizerService as unknown as AlchemyWebhookNormalizerService,
    );
  });

  it('stores a new webhook event with nested activities and publishes to kafka', async () => {
    normalizerService.normalize.mockReturnValue({
      eventId: 'whevt_1',
      webhookId: 'wh_1',
      eventType: 'ADDRESS_ACTIVITY',
      createdAt: new Date('2024-01-23T07:42:26.411Z'),
      network: 'ETH_MAINNET',
      rawPayload: {
        id: 'whevt_1',
      },
      activities: [
        {
          activityIndex: 0,
          sourceKind: 'ADDRESS_ACTIVITY',
          txHash: '0xtx',
          blockNum: '0x1',
          value: '1.25',
          payload: {
            hash: '0xtx',
          },
        },
      ],
    });

    const result = await service.ingest(
      { id: 'whevt_1' },
      { rawBody: '{"id":"whevt_1"}', signature: 'sig' },
    );

    expect(result).toEqual({
      status: 'accepted',
      eventId: 'whevt_1',
      activitiesStored: 1,
    });
    expect(prismaService.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: 'whevt_1',
        webhookId: 'wh_1',
        activities: {
          createMany: {
            data: [
              expect.objectContaining({
                txHash: '0xtx',
                value: '1.25',
              }),
            ],
          },
        },
      }),
    });
    expect(kafkaService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'whevt_1',
      }),
    );
  });

  it('treats a unique-constraint conflict as a duplicate event', async () => {
    normalizerService.normalize.mockReturnValue({
      eventId: 'whevt_1',
      webhookId: 'wh_1',
      eventType: 'ADDRESS_ACTIVITY',
      createdAt: new Date('2024-01-23T07:42:26.411Z'),
      rawPayload: {
        id: 'whevt_1',
      },
      activities: [],
    });
    prismaService.webhookEvent.create.mockRejectedValue({
      code: 'P2002',
    });
    prismaService.webhookEvent.findUnique.mockResolvedValue({
      eventId: 'whevt_1',
      activities: [{ id: 'activity_1' }, { id: 'activity_2' }],
    });

    const result = await service.ingest({ id: 'whevt_1' });

    expect(result).toEqual({
      status: 'duplicate',
      eventId: 'whevt_1',
      activitiesStored: 2,
    });
    expect(prismaService.webhookEvent.create).toHaveBeenCalledTimes(1);
    expect(prismaService.webhookEvent.findUnique).toHaveBeenCalledWith({
      where: {
        eventId: 'whevt_1',
      },
      include: {
        activities: {
          select: {
            id: true,
          },
        },
      },
    });
    expect(kafkaService.publish).not.toHaveBeenCalled();
  });
});
