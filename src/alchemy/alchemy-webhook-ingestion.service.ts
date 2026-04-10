import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AivenKafkaService } from '../kafka/aiven-kafka.service';
import { PrismaService } from '../prisma.service';
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
    private readonly kafkaService: AivenKafkaService,
    private readonly normalizerService: AlchemyWebhookNormalizerService,
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
    this.logger.log(
      `Start ingestion: eventId=${normalizedEvent.eventId}, type=${normalizedEvent.eventType}, activities=${normalizedEvent.activities.length}`,
    );
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
        return this.loadDuplicateResult(normalizedEvent.eventId);
      }

      const message =
        error instanceof Error ? error.message : 'Unknown ingestion error';
      this.logger.error(
        `Failed ingestion for eventId=${normalizedEvent.eventId}: ${message}`,
      );
      throw error;
    }

    this.logger.log(
      `Stored webhook event: eventId=${normalizedEvent.eventId}, activities=${normalizedEvent.activities.length}`,
    );
    await this.publishToKafka(normalizedEvent, receivedAt);

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

  private async publishToKafka(
    normalizedEvent: AlchemyWebhookEnvelope,
    receivedAt: Date,
  ): Promise<void> {
    const kafkaMessage = this.buildKafkaMessage(normalizedEvent, receivedAt);

    await this.kafkaService.publish({
      topic: this.getKafkaTopic(),
      key: normalizedEvent.eventId,
      value: kafkaMessage,
    });

    this.logger.log(`Published Kafka message: eventId=${normalizedEvent.eventId}`);
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
