import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { AivenKafkaService } from './kafka/aiven-kafka.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly kafkaService: AivenKafkaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('kafka/send')
  async sendKafkaMessage(@Query('message') message?: string): Promise<string> {
    const payload = message ?? 'Hello from NestJS kafkajs!';
    await this.kafkaService.sendMessage(payload);
    return `Kafka message queued: ${payload}`;
  }
}
