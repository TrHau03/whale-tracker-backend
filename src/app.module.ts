import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AivenKafkaService } from './kafka/aiven-kafka.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [],
  controllers: [AppController, WebhookController],
  providers: [AppService, AivenKafkaService],
})
export class AppModule {}
