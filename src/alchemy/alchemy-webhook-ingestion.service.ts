import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OutboxProcessorService } from '../outbox/outbox-processor.service';
import { AlchemyWebhookNormalizerService } from './alchemy-webhook-normalizer.service';
import {
  AlchemyWebhookEnvelope,
  KafkaWebhookMessage,
  NormalizedWebhookActivity,
  WebhookIngestionResult,
} from './alchemy-webhook.types';

@Injectable()
export class AlchemyWebhookIngestionService {
  private readonly logger = new Logger(AlchemyWebhookIngestionService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly normalizerService: AlchemyWebhookNormalizerService,
    private readonly outboxProcessorService: OutboxProcessorService,
  ) {}

  async ingest(
    payload: Record<string, unknown>,
    options?: {
      rawBody?: string;
      signature?: string;
    },
  ): Promise<WebhookIngestionResult> {
    const normalizedEvent = this.normalizerService.normalize(payload);
    const receivedAt = new Date();
    const webhookEventCreateInput = this.buildWebhookEventCreateInput(
      normalizedEvent,
      payload,
      receivedAt,
      options,
    );

    try {
      await this.prismaService.webhookEvent.create({
        data: webhookEventCreateInput,
      });
    } catch (error) {
      if (this.isDuplicateEventError(error)) {
        this.logger.warn(
          `Webhook event ${normalizedEvent.eventId} was inserted concurrently and treated as duplicate.`,
        );
        void this.outboxProcessorService.processPendingMessages();
        return this.loadDuplicateResult(normalizedEvent.eventId);
      }

      throw error;
    }

    void this.outboxProcessorService.processPendingMessages();

    return {
      status: 'accepted',
      eventId: normalizedEvent.eventId,
      activitiesStored: normalizedEvent.activities.length,
    };
  }

  private buildWebhookEventCreateInput(
    normalizedEvent: AlchemyWebhookEnvelope,
    payload: Record<string, unknown>,
    receivedAt: Date,
    options?: {
      rawBody?: string;
      signature?: string;
    },
  ): Prisma.WebhookEventCreateInput {
    const activities = normalizedEvent.activities.map((activity) => ({
      sourceKind: activity.sourceKind,
      activityIndex: activity.activityIndex,
      txHash: activity.txHash,
      blockNum: activity.blockNum,
      category: activity.category,
      fromAddress: activity.fromAddress,
      toAddress: activity.toAddress,
      assetSymbol: activity.assetSymbol,
      assetAddress: activity.assetAddress,
      rawValue: activity.rawValue,
      value: activity.value,
      accountAddress: activity.accountAddress,
      txIndex: activity.txIndex,
      gasPrice: activity.gasPrice,
      maxFeePerGas: activity.maxFeePerGas,
      maxPriorityFeePerGas: activity.maxPriorityFeePerGas,
      gas: activity.gas,
      txStatus: activity.txStatus,
      gasUsed: activity.gasUsed,
      cumulativeGasUsed: activity.cumulativeGasUsed,
      effectiveGasPrice: activity.effectiveGasPrice,
      createdContract: activity.createdContract,
      tokenId: activity.tokenId,
      logIndex: activity.logIndex,
      removed: activity.removed,
      payload: this.toJsonValue(activity.payload),
    }));
    const kafkaMessage = this.buildKafkaMessage(normalizedEvent, receivedAt);

    return {
      eventId: normalizedEvent.eventId,
      webhookId: normalizedEvent.webhookId,
      eventType: normalizedEvent.eventType,
      network: normalizedEvent.network,
      sequenceNumber: normalizedEvent.sequenceNumber,
      createdAt: normalizedEvent.createdAt,
      receivedAt,
      signature: options?.signature,
      rawBody: options?.rawBody ?? JSON.stringify(payload),
      payload: this.toJsonValue(normalizedEvent.rawPayload),
      activities:
        activities.length > 0
          ? {
              createMany: {
                data: activities,
              },
            }
          : undefined,
      outboxMessages: {
        create: {
          dedupeKey: `alchemy:${normalizedEvent.eventId}`,
          topic: this.getKafkaTopic(),
          messageKey: normalizedEvent.eventId,
          payload: this.toJsonValue(kafkaMessage),
        },
      },
    };
  }

  private async loadDuplicateResult(
    eventId: string,
  ): Promise<WebhookIngestionResult> {
    const duplicateEvent = await this.prismaService.webhookEvent.findUnique({
      where: {
        eventId,
      },
      include: {
        activities: {
          select: {
            id: true,
          },
        },
      },
    });

    return {
      status: 'duplicate',
      eventId,
      activitiesStored: duplicateEvent?.activities.length ?? 0,
    };
  }

  private buildKafkaMessage(
    normalizedEvent: AlchemyWebhookEnvelope,
    receivedAt: Date,
  ): KafkaWebhookMessage {
    return {
      schemaVersion: 1,
      source: 'alchemy',
      eventId: normalizedEvent.eventId,
      webhookId: normalizedEvent.webhookId,
      eventType: normalizedEvent.eventType,
      network: normalizedEvent.network,
      sequenceNumber: normalizedEvent.sequenceNumber,
      createdAt: normalizedEvent.createdAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
      activities: normalizedEvent.activities.map((activity) =>
        this.serializeActivity(activity),
      ),
      rawPayload: normalizedEvent.rawPayload,
    };
  }

  private serializeActivity(activity: NormalizedWebhookActivity) {
    return {
      activityIndex: activity.activityIndex,
      sourceKind: activity.sourceKind,
      txHash: activity.txHash,
      blockNum: activity.blockNum,
      category: activity.category,
      fromAddress: activity.fromAddress,
      toAddress: activity.toAddress,
      assetSymbol: activity.assetSymbol,
      assetAddress: activity.assetAddress,
      rawValue: activity.rawValue,
      value: activity.value,
      accountAddress: activity.accountAddress,
      txIndex: activity.txIndex,
      gasPrice: activity.gasPrice,
      maxFeePerGas: activity.maxFeePerGas,
      maxPriorityFeePerGas: activity.maxPriorityFeePerGas,
      gas: activity.gas,
      txStatus: activity.txStatus,
      gasUsed: activity.gasUsed,
      cumulativeGasUsed: activity.cumulativeGasUsed,
      effectiveGasPrice: activity.effectiveGasPrice,
      createdContract: activity.createdContract,
      tokenId: activity.tokenId,
      logIndex: activity.logIndex,
      removed: activity.removed,
    };
  }

  private getKafkaTopic(): string {
    return (
      process.env.ALCHEMY_KAFKA_TOPIC?.trim() ||
      process.env.AIVEN_KAFKA_TOPIC?.trim() ||
      'alchemy.webhooks'
    );
  }

  private isDuplicateEventError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
