import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AlchemyWebhookEnvelope,
  NormalizedWebhookActivity,
} from './alchemy-webhook.types';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class AlchemyWebhookNormalizerService {
  normalize(payload: JsonRecord): AlchemyWebhookEnvelope {
    const eventId = this.requireString(payload.id, 'Missing webhook event id');
    const webhookId = this.requireString(
      payload.webhookId,
      'Missing webhook id',
    );
    const eventType = this.requireString(
      payload.type,
      'Missing webhook event type',
    );
    const createdAt = this.requireDate(
      payload.createdAt,
      'Invalid webhook createdAt timestamp',
    );
    const event = this.asRecord(payload.event);

    return {
      eventId,
      webhookId,
      eventType,
      createdAt,
      network:
        this.asString(this.readPath(event, ['network'])) ??
        this.asString(this.readPath(event, ['data', 'network'])),
      sequenceNumber: this.asString(this.readPath(event, ['sequenceNumber'])),
      rawPayload: payload,
      activities: this.extractActivities(eventType, event),
    };
  }

  private extractActivities(
    eventType: string,
    event?: JsonRecord,
  ): NormalizedWebhookActivity[] {
    if (!event) {
      return [];
    }

    if (eventType === 'ADDRESS_ACTIVITY') {
      return this.extractAddressActivities(event);
    }

    if (eventType === 'GRAPHQL') {
      return this.extractGraphqlActivities(event);
    }

    return [];
  }

  private extractAddressActivities(
    event: JsonRecord,
  ): NormalizedWebhookActivity[] {
    const activityItems = this.asArray(event.activity);
    const activities: NormalizedWebhookActivity[] = [];

    activityItems.forEach((entry, index) => {
      const activity = this.asRecord(entry);
      if (!activity) {
        return;
      }

      const rawContract = this.asRecord(activity.rawContract);
      const log = this.asRecord(activity.log);
      const rawValue =
        this.asString(rawContract?.rawValue) ??
        this.asString(activity.rawValue);
      const decimals = this.asNumber(rawContract?.decimals);

      activities.push({
        activityIndex: index,
        sourceKind: 'ADDRESS_ACTIVITY',
        txHash: this.asString(activity.hash),
        blockNum: this.asString(activity.blockNum),
        category: this.asString(activity.category),
        fromAddress: this.asString(activity.fromAddress),
        toAddress: this.asString(activity.toAddress),
        assetSymbol: this.asString(activity.asset),
        assetAddress:
          this.asString(rawContract?.address) ?? this.asString(log?.address),
        rawValue,
        value: this.resolveValue(rawValue, decimals, activity.value),
        tokenId: this.extractTokenId(activity),
        logIndex: this.asString(log?.logIndex),
        removed: this.asBoolean(log?.removed),
        payload: activity,
      });
    });

    return activities;
  }

  private extractGraphqlActivities(
    event: JsonRecord,
  ): NormalizedWebhookActivity[] {
    const activities: NormalizedWebhookActivity[] = [];
    const data = this.asRecord(event.data);
    const block = this.asRecord(data?.block);
    const blockNumber = this.stringifyValue(block?.number);

    this.appendGraphqlLogEntries(
      activities,
      this.asArray(block?.logs),
      blockNumber,
    );

    const blockTransactions = this.asArray(block?.transactions);
    blockTransactions.forEach((transactionEntry) => {
      this.appendGraphqlTransaction(
        activities,
        this.asRecord(transactionEntry),
        blockNumber,
      );
    });

    this.appendGraphqlTransaction(
      activities,
      this.asRecord(data?.transaction),
      blockNumber,
    );

    const topLevelTransactions = this.asArray(data?.transactions);
    topLevelTransactions.forEach((transactionEntry) => {
      this.appendGraphqlTransaction(
        activities,
        this.asRecord(transactionEntry),
        blockNumber,
      );
    });

    return activities;
  }

  private appendGraphqlLogEntries(
    activities: NormalizedWebhookActivity[],
    entries: unknown[],
    blockNumber?: string,
  ): void {
    entries.forEach((entry) => {
      const logEntry = this.asRecord(entry);
      if (!logEntry) {
        return;
      }

      const transaction = this.asRecord(logEntry.transaction);
      const transactionLogs = this.asArray(transaction?.logs);
      if (transaction && transactionLogs.length > 0) {
        transactionLogs.forEach((nestedLogEntry) => {
          const nestedLog = this.asRecord(nestedLogEntry);
          if (!nestedLog) {
            return;
          }

          activities.push(
            this.createGraphqlActivity(
              activities.length,
              nestedLog,
              transaction,
              blockNumber,
            ),
          );
        });
        return;
      }

      activities.push(
        this.createGraphqlActivity(
          activities.length,
          logEntry,
          transaction,
          blockNumber,
        ),
      );
    });
  }

  private appendGraphqlTransaction(
    activities: NormalizedWebhookActivity[],
    transaction: JsonRecord | undefined,
    blockNumber?: string,
  ): void {
    if (!transaction) {
      return;
    }

    const logs = this.asArray(transaction.logs);
    if (logs.length === 0) {
      activities.push(
        this.createGraphqlActivity(
          activities.length,
          transaction,
          transaction,
          blockNumber,
        ),
      );
      return;
    }

    logs.forEach((logEntry) => {
      const log = this.asRecord(logEntry);
      if (!log) {
        return;
      }

      activities.push(
        this.createGraphqlActivity(
          activities.length,
          log,
          transaction,
          blockNumber,
        ),
      );
    });
  }

  private createGraphqlActivity(
    activityIndex: number,
    log: JsonRecord,
    transaction?: JsonRecord,
    blockNumber?: string,
  ): NormalizedWebhookActivity {
    const accountAddress = this.asString(this.readPath(log, ['account', 'address']));

    return {
      activityIndex,
      sourceKind: 'GRAPHQL_LOG',
      txHash:
        this.asString(transaction?.hash) ?? this.asString(log.transactionHash),
      blockNum:
        this.stringifyValue(log.blockNumber) ??
        this.stringifyValue(transaction?.blockNumber) ??
        blockNumber,
      category: 'graphql',
      fromAddress: this.asString(
        this.readPath(transaction, ['from', 'address']),
      ),
      toAddress: this.asString(this.readPath(transaction, ['to', 'address'])),
      assetAddress:
        accountAddress ?? this.asString(log.address),
      rawValue:
        this.asString(log.data) ?? this.asString(transaction?.value),
      accountAddress,
      txIndex: this.asInteger(transaction?.index),
      gasPrice: this.asString(transaction?.gasPrice),
      maxFeePerGas: this.asString(transaction?.maxFeePerGas),
      maxPriorityFeePerGas: this.asString(transaction?.maxPriorityFeePerGas),
      gas: this.asInteger(transaction?.gas),
      txStatus: this.asInteger(transaction?.status),
      gasUsed: this.asInteger(transaction?.gasUsed),
      cumulativeGasUsed: this.asInteger(transaction?.cumulativeGasUsed),
      effectiveGasPrice: this.asString(transaction?.effectiveGasPrice),
      createdContract: this.asString(
        this.readPath(transaction, ['createdContract', 'address']),
      ),
      logIndex: this.stringifyValue(log.index) ?? this.asString(log.logIndex),
      removed: this.asBoolean(log.removed),
      payload: log,
    };
  }

  private extractTokenId(activity: JsonRecord): string | undefined {
    const erc721TokenId = this.asString(activity.erc721TokenId);
    if (erc721TokenId) {
      return erc721TokenId;
    }

    const erc1155Metadata = this.asArray(activity.erc1155Metadata);
    const firstEntry = this.asRecord(erc1155Metadata[0]);
    return this.asString(firstEntry?.tokenId);
  }

  private resolveValue(
    rawValue: string | undefined,
    decimals: number | undefined,
    fallbackValue: unknown,
  ): string | undefined {
    if (rawValue?.startsWith('0x') && typeof decimals === 'number') {
      return this.hexToDecimalString(rawValue, decimals);
    }

    if (typeof fallbackValue === 'number' && Number.isFinite(fallbackValue)) {
      return fallbackValue.toString();
    }

    return this.asString(fallbackValue);
  }

  private hexToDecimalString(value: string, decimals: number): string {
    const raw = BigInt(value);
    if (decimals <= 0) {
      return raw.toString();
    }

    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    const fractionText = fraction.toString().padStart(decimals, '0');
    return `${whole.toString()}.${fractionText}`.replace(/\.?0+$/, '');
  }

  private requireString(value: unknown, message: string): string {
    const normalized = this.asString(value);
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
  }

  private requireDate(value: unknown, message: string): Date {
    const parsed = this.parseDate(value);
    if (!parsed) {
      throw new BadRequestException(message);
    }
    return parsed;
  }

  private readPath(
    value: JsonRecord | undefined,
    path: string[],
  ): unknown | undefined {
    let current: unknown = value;
    for (const segment of path) {
      const currentRecord = this.asRecord(current);
      if (!currentRecord) {
        return undefined;
      }
      current = currentRecord[segment];
    }
    return current;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private asRecord(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonRecord)
      : undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private stringifyValue(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }
    return undefined;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private asInteger(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const raw = value.trim();
      if (raw.length === 0) {
        return undefined;
      }

      if (/^0x[0-9a-f]+$/i.test(raw)) {
        const parsedHex = Number.parseInt(raw, 16);
        return Number.isInteger(parsedHex) ? parsedHex : undefined;
      }

      const parsed = Number.parseInt(raw, 10);
      return Number.isInteger(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private asBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private parseDate(value: unknown): Date | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
