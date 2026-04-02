import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AlchemyWebhookAuthService } from './alchemy/alchemy-webhook-auth.service';
import { AlchemyWebhookIngestionService } from './alchemy/alchemy-webhook-ingestion.service';
import { WebhookIngestionResult } from './alchemy/alchemy-webhook.types';

type RequestWithRawBody = Request & { rawBody?: string };

@Controller('alchemy-webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly authService: AlchemyWebhookAuthService,
    private readonly ingestionService: AlchemyWebhookIngestionService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleAlchemyWebhook(
    @Body() payload: Record<string, unknown>,
    @Req() req: RequestWithRawBody,
  ): Promise<WebhookIngestionResult> {
    this.logIncomingWebhook(req, payload);

    const signature = this.authService.verifyRequest(req, payload);

    return this.ingestionService.ingest(payload, {
      rawBody: req.rawBody,
      signature,
    });
  }

  private logIncomingWebhook(
    req: RequestWithRawBody,
    payload: Record<string, unknown>,
  ): void {
    const rawBody = req.rawBody ?? JSON.stringify(payload);
    const eventId =
      typeof payload.id === 'string' && payload.id.length > 0
        ? payload.id
        : 'unknown';
    const webhookId =
      typeof payload.webhookId === 'string' && payload.webhookId.length > 0
        ? payload.webhookId
        : 'unknown';
    const eventType =
      typeof payload.type === 'string' && payload.type.length > 0
        ? payload.type
        : 'unknown';
    const payloadLog = this.truncateForLogs(rawBody);

    this.logger.log(
      `Incoming Alchemy webhook: eventId=${eventId}, webhookId=${webhookId}, type=${eventType}, rawBodyLength=${rawBody.length}`,
    );
    this.logger.log(`Incoming Alchemy webhook payload: ${payloadLog}`);
  }

  private truncateForLogs(value: string): string {
    const maxLength = Number(process.env.ALCHEMY_WEBHOOK_LOG_MAX_LENGTH ?? 12000);
    const safeMaxLength =
      Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 12000;

    if (value.length <= safeMaxLength) {
      return value;
    }

    return `${value.slice(0, safeMaxLength)}... [truncated ${value.length - safeMaxLength} chars]`;
  }
}
