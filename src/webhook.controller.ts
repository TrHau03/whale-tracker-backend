import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AlchemyWebhookAuthService } from './alchemy/alchemy-webhook-auth.service';
import { AlchemyWebhookIngestionService } from './alchemy/alchemy-webhook-ingestion.service';
import { WebhookIngestionResult } from './alchemy/alchemy-webhook.types';

type RequestWithRawBody = Request & { rawBody?: string };

@Controller('alchemy-webhook')
export class WebhookController {
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
    const signature = this.authService.verifyRequest(req, payload);

    return this.ingestionService.ingest(payload, {
      rawBody: req.rawBody,
      signature,
    });
  }
}
