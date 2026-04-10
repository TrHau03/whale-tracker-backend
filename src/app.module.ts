import { Module } from '@nestjs/common';
import { AlchemyWebhookAuthService } from './alchemy/alchemy-webhook-auth.service';
import { AlchemyWebhookIngestionService } from './alchemy/alchemy-webhook-ingestion.service';
import { AlchemyWebhookNormalizerService } from './alchemy/alchemy-webhook-normalizer.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AivenKafkaService } from './kafka/aiven-kafka.service';
import { PrismaService } from './prisma.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [],
  controllers: [AppController, WebhookController],
  providers: [
    AppService,
    AivenKafkaService,
    PrismaService,
    AlchemyWebhookAuthService,
    AlchemyWebhookNormalizerService,
    AlchemyWebhookIngestionService,
  ],
})
export class AppModule {}
