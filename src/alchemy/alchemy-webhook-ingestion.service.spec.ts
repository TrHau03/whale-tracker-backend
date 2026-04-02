import { PrismaService } from '../prisma.service';
import { OutboxProcessorService } from '../outbox/outbox-processor.service';
import { AlchemyWebhookIngestionService } from './alchemy-webhook-ingestion.service';
import { AlchemyWebhookNormalizerService } from './alchemy-webhook-normalizer.service';

describe('AlchemyWebhookIngestionService', () => {
  const normalizerService = {
    normalize: jest.fn(),
  };
  const outboxProcessorService = {
    processPendingMessages: jest.fn(),
  };
  const prismaTransaction = {
    webhookEvent: {
      create: jest.fn(),
    },
    webhookActivity: {
      createMany: jest.fn(),
    },
    kafkaOutbox: {
      create: jest.fn(),
    },
  };
  const prismaService = {
    webhookEvent: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: AlchemyWebhookIngestionService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaTransaction) => Promise<void>) =>
        callback(prismaTransaction),
    );
    prismaTransaction.webhookEvent.create.mockResolvedValue({
      id: 'db_event_1',
    });
    outboxProcessorService.processPendingMessages.mockResolvedValue(1);

    service = new AlchemyWebhookIngestionService(
      prismaService as unknown as PrismaService,
      normalizerService as unknown as AlchemyWebhookNormalizerService,
      outboxProcessorService as unknown as OutboxProcessorService,
    );
  });

  it('stores new webhook events, activities, and one Kafka outbox message', async () => {
    prismaService.webhookEvent.findUnique.mockResolvedValue(null);
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
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaTransaction.webhookEvent.create).toHaveBeenCalled();
    expect(prismaTransaction.webhookActivity.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          webhookEventId: 'db_event_1',
          txHash: '0xtx',
          value: '1.25',
        }),
      ],
    });
    expect(prismaTransaction.kafkaOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dedupeKey: 'alchemy:whevt_1',
        messageKey: 'whevt_1',
      }),
    });
    expect(outboxProcessorService.processPendingMessages).toHaveBeenCalledTimes(
      1,
    );
  });

  it('treats an existing event id as a duplicate and skips persistence', async () => {
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
    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(outboxProcessorService.processPendingMessages).toHaveBeenCalledTimes(
      1,
    );
  });
});
