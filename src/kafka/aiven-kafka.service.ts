import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Consumer, Kafka, logLevel, Producer, SASLOptions } from 'kafkajs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

@Injectable()
export class AivenKafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AivenKafkaService.name);
  private producer?: Producer;
  private consumer?: Consumer;
  private ready = false;

  private get topicName(): string {
    return process.env.AIVEN_KAFKA_TOPIC ?? 'raw_txs';
  }

  private getSaslOptions(
    saslMechanism: string,
    username: string,
    password: string,
  ): SASLOptions {
    const mechanism = saslMechanism.toLowerCase();
    if (mechanism === 'plain') {
      return { mechanism: 'plain', username, password };
    }
    if (mechanism === 'scram-sha-512') {
      return { mechanism: 'scram-sha-512', username, password };
    }
    return { mechanism: 'scram-sha-256', username, password };
  }

  async onModuleInit(): Promise<void> {
    const broker = process.env.AIVEN_KAFKA_BROKER;
    const username = process.env.AIVEN_KAFKA_USERNAME;
    const password = process.env.AIVEN_KAFKA_PASSWORD;
    const caLocation = process.env.AIVEN_KAFKA_CA_LOCATION ?? 'ca.pem';
    const groupId = process.env.AIVEN_KAFKA_GROUP_ID ?? 'whale-tracker-group';
    const saslMechanism =
      process.env.AIVEN_KAFKA_SASL_MECHANISM ?? 'SCRAM-SHA-256';
    const enabled = process.env.AIVEN_KAFKA_ENABLED === 'true';

    if (!enabled) {
      this.logger.log(
        'Aiven Kafka is disabled. Set AIVEN_KAFKA_ENABLED=true to start producer/consumer.',
      );
      return;
    }

    if (!broker || !username || !password) {
      this.logger.warn(
        'Missing Kafka credentials. Set AIVEN_KAFKA_BROKER, AIVEN_KAFKA_USERNAME, AIVEN_KAFKA_PASSWORD.',
      );
      return;
    }

    const kafka = new Kafka({
      clientId: 'whale-tracker-backend',
      brokers: [broker],
      ssl: {
        ca: [readFileSync(resolve(process.cwd(), caLocation), 'utf8')],
      },
      sasl: this.getSaslOptions(saslMechanism, username, password),
      logLevel: logLevel.NOTHING,
    });

    const producer = kafka.producer();
    const consumer = kafka.consumer({ groupId });

    try {
      await producer.connect();
      await consumer.connect();
      await consumer.subscribe({ topic: this.topicName, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ message }) => {
          await Promise.resolve();
          this.logger.log(`Got message: ${message.value?.toString() ?? ''}`);
        },
      });

      this.producer = producer;
      this.consumer = consumer;
      this.ready = true;
      this.logger.log(`Kafka producer/consumer connected (${this.topicName}).`);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Unknown Kafka init error';
      this.logger.error(`Kafka connect failed: ${msg}`);
    }
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.producer || !this.ready) {
      this.logger.warn('Kafka producer is not connected yet.');
      return;
    }

    await this.producer.send({
      topic: this.topicName,
      messages: [{ value: message }],
    });

    this.logger.log(`Message sent: ${message}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.ready = false;
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }
}
