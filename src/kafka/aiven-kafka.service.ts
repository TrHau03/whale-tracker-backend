import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, logLevel, Producer, SASLOptions } from 'kafkajs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PublishKafkaMessageInput {
  topic?: string;
  key?: string;
  value: unknown;
}

@Injectable()
export class AivenKafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AivenKafkaService.name);
  private producer?: Producer;
  private ready = false;

  private get topicName(): string {
    return process.env.AIVEN_KAFKA_TOPIC ?? 'alchemy.webhooks';
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
    const certLocation =
      process.env.AIVEN_KAFKA_CERT_LOCATION ?? 'service.cert';
    const keyLocation = process.env.AIVEN_KAFKA_KEY_LOCATION ?? 'service.key';
    const saslMechanism =
      process.env.AIVEN_KAFKA_SASL_MECHANISM ?? 'SCRAM-SHA-256';
    const enabled = process.env.AIVEN_KAFKA_ENABLED === 'true';

    if (!enabled) {
      this.logger.log(
        'Aiven Kafka is disabled. Set AIVEN_KAFKA_ENABLED=true to start the producer.',
      );
      return;
    }

    if (!broker) {
      this.logger.warn('Missing Kafka broker. Set AIVEN_KAFKA_BROKER.');
      return;
    }

    const hasSasl = Boolean(username && password);
    const hasClientCertificates =
      existsSync(resolve(process.cwd(), certLocation)) &&
      existsSync(resolve(process.cwd(), keyLocation));

    const kafka = new Kafka({
      clientId: 'whale-tracker-backend',
      brokers: [broker],
      ssl: {
        ca: [readFileSync(resolve(process.cwd(), caLocation), 'utf8')],
        cert: hasClientCertificates
          ? readFileSync(resolve(process.cwd(), certLocation), 'utf8')
          : undefined,
        key: hasClientCertificates
          ? readFileSync(resolve(process.cwd(), keyLocation), 'utf8')
          : undefined,
      },
      sasl:
        hasSasl && username && password
          ? this.getSaslOptions(saslMechanism, username, password)
          : undefined,
      logLevel: logLevel.NOTHING,
    });

    const producer = kafka.producer();

    try {
      await producer.connect();

      this.producer = producer;
      this.ready = true;
      this.logger.log(`Kafka producer connected (${this.topicName}).`);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Unknown Kafka init error';
      this.logger.error(`Kafka connect failed: ${msg}`);
      this.logger.error(
        `Check AIVEN_KAFKA_TOPIC=${this.topicName} exists and Render env values are correct.`,
      );
    }
  }

  async publish({
    topic,
    key,
    value,
  }: PublishKafkaMessageInput): Promise<void> {
    if (!this.producer || !this.ready) {
      throw new Error('Kafka producer is not connected yet.');
    }

    const messageValue =
      typeof value === 'string' ? value : JSON.stringify(value);

    await this.producer.send({
      topic: topic ?? this.topicName,
      messages: [{ key, value: messageValue }],
    });

    this.logger.log(`Message sent to topic ${topic ?? this.topicName}.`);
  }

  async sendMessage(message: string): Promise<void> {
    await this.publish({
      value: message,
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.ready = false;
    await this.producer?.disconnect();
  }
}
