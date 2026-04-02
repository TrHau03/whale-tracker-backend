import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { KafkaOutboxStatus } from '@prisma/client';
import { AivenKafkaService } from '../kafka/aiven-kafka.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class OutboxProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessorService.name);
  private pollTimer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly kafkaService: AivenKafkaService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.OUTBOX_PROCESSOR_ENABLED === 'false') {
      this.logger.log('Kafka outbox processor is disabled.');
      return;
    }

    const intervalMs = this.getPollIntervalMs();
    this.pollTimer = setInterval(() => {
      void this.processPendingMessages();
    }, intervalMs);
    this.pollTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }

  async processPendingMessages(): Promise<number> {
    if (this.processing) {
      return 0;
    }

    this.processing = true;

    try {
      const candidates = await this.prismaService.kafkaOutbox.findMany({
        where: {
          status: {
            in: [KafkaOutboxStatus.PENDING, KafkaOutboxStatus.FAILED],
          },
          availableAt: {
            lte: new Date(),
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: this.getBatchSize(),
      });

      let publishedCount = 0;

      for (const candidate of candidates) {
        const claim = await this.prismaService.kafkaOutbox.updateMany({
          where: {
            id: candidate.id,
            status: {
              in: [KafkaOutboxStatus.PENDING, KafkaOutboxStatus.FAILED],
            },
          },
          data: {
            status: KafkaOutboxStatus.PROCESSING,
            attempts: {
              increment: 1,
            },
            lastError: null,
          },
        });

        if (claim.count === 0) {
          continue;
        }

        const claimedMessage = await this.prismaService.kafkaOutbox.findUnique({
          where: {
            id: candidate.id,
          },
        });

        if (!claimedMessage) {
          continue;
        }

        try {
          await this.kafkaService.publish({
            topic: claimedMessage.topic,
            key: claimedMessage.messageKey ?? undefined,
            value: claimedMessage.payload,
          });

          await this.prismaService.kafkaOutbox.update({
            where: {
              id: claimedMessage.id,
            },
            data: {
              status: KafkaOutboxStatus.PUBLISHED,
              publishedAt: new Date(),
              lastError: null,
            },
          });

          publishedCount += 1;
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown Kafka publish error';

          await this.prismaService.kafkaOutbox.update({
            where: {
              id: claimedMessage.id,
            },
            data: {
              status: KafkaOutboxStatus.FAILED,
              lastError: message.slice(0, 1000),
              availableAt: new Date(
                Date.now() + this.getRetryDelayMs(claimedMessage.attempts),
              ),
            },
          });

          this.logger.error(
            `Kafka publish failed for outbox ${claimedMessage.id}: ${message}`,
          );
        }
      }

      return publishedCount;
    } finally {
      this.processing = false;
    }
  }

  private getBatchSize(): number {
    const raw = Number(process.env.OUTBOX_BATCH_SIZE ?? 50);
    return Number.isFinite(raw) && raw > 0 ? raw : 50;
  }

  private getPollIntervalMs(): number {
    const raw = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 5000);
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
  }

  private getRetryDelayMs(attempts: number): number {
    const baseDelayMs = Number(process.env.OUTBOX_RETRY_BASE_MS ?? 5000);
    const maxDelayMs = Number(process.env.OUTBOX_RETRY_MAX_MS ?? 300000);
    const safeBase =
      Number.isFinite(baseDelayMs) && baseDelayMs > 0 ? baseDelayMs : 5000;
    const safeMax =
      Number.isFinite(maxDelayMs) && maxDelayMs > 0 ? maxDelayMs : 300000;
    const delay = safeBase * 2 ** Math.max(0, attempts - 1);
    return Math.min(delay, safeMax);
  }
}
