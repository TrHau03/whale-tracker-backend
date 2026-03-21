import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { AivenKafkaService } from './kafka/aiven-kafka.service';

type AlchemyActivity = Record<string, unknown>;

interface AlchemyWebhookPayload {
  id?: string;
  webhookId?: string;
  type?: string;
  createdAt?: string;
  event?: {
    network?: string;
    activity?: AlchemyActivity[];
  };
}

@Controller('alchemy-webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly kafkaService: AivenKafkaService) {}

  @Post()
  @HttpCode(200)
  handleAlchemyWebhook(@Body() payload: AlchemyWebhookPayload): {
    status: string;
    activities: number;
  } {
    const activities = payload.event?.activity ?? [];

    // Return 200 quickly; publish in background to reduce webhook timeout risk.
    void this.publishActivities(payload, activities);

    return { status: 'received', activities: activities.length };
  }

  private async publishActivities(
    payload: AlchemyWebhookPayload,
    activities: AlchemyActivity[],
  ): Promise<void> {
    try {
      if (activities.length === 0) {
        await this.kafkaService.sendMessage(JSON.stringify(payload));
        return;
      }

      for (const activity of activities) {
        const message = {
          webhookId: payload.webhookId,
          eventId: payload.id,
          type: payload.type,
          createdAt: payload.createdAt,
          network: payload.event?.network,
          activity,
        };

        await this.kafkaService.sendMessage(JSON.stringify(message));
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Unknown publish error';
      this.logger.error(`Kafka publish failed: ${msg}`);
    }
  }
}
