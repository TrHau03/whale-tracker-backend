import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AivenKafkaService } from './kafka/aiven-kafka.service';
import { PrismaService } from './prisma.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [],
  controllers: [AppController, WebhookController],
  providers: [AppService, AivenKafkaService, PrismaService],
})
export class AppModule {}
