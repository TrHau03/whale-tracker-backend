import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AivenKafkaService } from './kafka/aiven-kafka.service';
import { PrismaService } from './prisma.service';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

interface CleanTransactionPayload {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  asset: string;
  value: number;
  blockNum: string;
  timestamp: Date;
}

type RequestWithRawBody = Request & { rawBody?: string };

@Controller('alchemy-webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly kafkaService: AivenKafkaService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleAlchemyWebhook(
    @Body() payload: Record<string, unknown>,
    @Req() req: RequestWithRawBody,
  ): Promise<Record<string, unknown>> {
    this.verifyWebhookRequest(req, payload);

    const transactions = this.extractTransactions(payload);
    if (transactions.length === 0) {
      return { status: 'ignored', message: 'No supported transaction found' };
    }

    let successCount = 0;
    for (const cleanData of transactions) {
      try {
        await this.prismaService.transaction.upsert({
          where: { txHash: cleanData.txHash },
          update: {},
          create: cleanData,
        });
        await this.kafkaService.sendMessage(JSON.stringify(cleanData));
        successCount += 1;
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Unknown ingestion error';
        this.logger.error(`Ingestion failed for tx ${cleanData.txHash}: ${msg}`);
      }
    }

    return {
      status: 'ingested',
      ingested: successCount,
      total: transactions.length,
    };
  }

  private verifyWebhookRequest(
    req: RequestWithRawBody,
    payload: Record<string, unknown>,
  ): void {
    const expectedToken = process.env.ALCHEMY_AUTH_TOKEN?.trim();
    if (expectedToken) {
      const incomingToken = this.extractIncomingToken(req);
      if (!incomingToken || incomingToken !== expectedToken) {
        throw new UnauthorizedException('Invalid auth token');
      }
    }

    const signingKey = process.env.ALCHEMY_SIGNING_KEY?.trim();
    if (!signingKey) {
      return;
    }

    const signatureHeader = req.headers['x-alchemy-signature'];
    const incomingSignature =
      typeof signatureHeader === 'string'
        ? signatureHeader.trim()
        : Array.isArray(signatureHeader)
          ? (signatureHeader[0] ?? '').trim()
          : '';
    if (!incomingSignature) {
      throw new UnauthorizedException('Missing Alchemy signature');
    }

    const rawPayload = req.rawBody ?? JSON.stringify(payload);
    const expectedSignature = createHmac('sha256', signingKey)
      .update(rawPayload)
      .digest('hex');

    if (!this.secureCompare(expectedSignature, incomingSignature)) {
      throw new UnauthorizedException('Invalid Alchemy signature');
    }
  }

  private extractIncomingToken(req: RequestWithRawBody): string | null {
    const headerToken = req.headers['x-alchemy-token'];
    if (typeof headerToken === 'string' && headerToken.trim().length > 0) {
      return headerToken.trim();
    }
    if (Array.isArray(headerToken) && headerToken[0]?.trim()) {
      return headerToken[0].trim();
    }

    const authorizationHeader = req.headers.authorization;
    if (typeof authorizationHeader === 'string') {
      const bearerPrefix = 'bearer ';
      if (authorizationHeader.toLowerCase().startsWith(bearerPrefix)) {
        const bearerValue = authorizationHeader.slice(bearerPrefix.length).trim();
        if (bearerValue.length > 0) {
          return bearerValue;
        }
      }
    }

    return null;
  }

  private secureCompare(expected: string, incoming: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const incomingBuffer = Buffer.from(incoming, 'utf8');
    if (expectedBuffer.length !== incomingBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, incomingBuffer);
  }

  private extractTransactions(
    payload: Record<string, unknown>,
  ): CleanTransactionPayload[] {
    const createdAtRaw = payload.createdAt;
    const createdAt = this.parseDate(createdAtRaw) ?? new Date();

    const transactionsFromEvent = this.extractFromAddressActivity(payload);
    if (transactionsFromEvent.length > 0) {
      return transactionsFromEvent.map((item) => ({
        ...item,
        timestamp: createdAt,
      }));
    }

    const transactionsFromBlockLogs = this.extractFromCustomBlockLogs(payload);
    if (transactionsFromBlockLogs.length > 0) {
      return transactionsFromBlockLogs;
    }

    const single = this.extractFromRawTransferLog(payload, createdAt);
    return single ? [single] : [];
  }

  private extractFromAddressActivity(
    payload: Record<string, unknown>,
  ): Omit<CleanTransactionPayload, 'timestamp'>[] {
    if (payload.type !== 'ADDRESS_ACTIVITY') {
      return [];
    }

    const event = payload.event;
    if (!event || typeof event !== 'object') {
      return [];
    }

    const activities = (event as { activity?: unknown }).activity;
    if (!Array.isArray(activities)) {
      return [];
    }

    const cleanItems: Omit<CleanTransactionPayload, 'timestamp'>[] = [];
    for (const activity of activities) {
      if (!activity || typeof activity !== 'object') {
        continue;
      }
      const item = activity as Record<string, unknown>;
      const hash = item.hash;
      const fromAddress = item.fromAddress;
      const toAddress = item.toAddress;
      const asset = item.asset;
      const value = item.value;
      const blockNum = item.blockNum;

      if (
        typeof hash === 'string' &&
        typeof fromAddress === 'string' &&
        typeof toAddress === 'string' &&
        typeof asset === 'string' &&
        typeof value === 'number' &&
        typeof blockNum === 'string'
      ) {
        cleanItems.push({
          txHash: hash,
          fromAddress,
          toAddress,
          asset,
          value,
          blockNum,
        });
      }
    }
    return cleanItems;
  }

  private extractFromRawTransferLog(
    payload: Record<string, unknown>,
    timestamp: Date,
  ): CleanTransactionPayload | null {
    const transaction = payload.transaction;
    if (!transaction || typeof transaction !== 'object') {
      return null;
    }

    const tx = transaction as Record<string, unknown>;
    const hash = tx.hash;
    const blockNum = tx.nonce;
    const from = tx.from as { address?: string } | undefined;
    const to = tx.to as { address?: string } | undefined;
    const account = payload.account as { address?: string } | undefined;
    const rawValue = payload.data;

    if (
      typeof hash !== 'string' ||
      typeof blockNum !== 'number' ||
      typeof from?.address !== 'string' ||
      typeof to?.address !== 'string'
    ) {
      return null;
    }

    const assetAddress = account?.address ?? 'UNKNOWN_ASSET';
    const decimals = this.getAssetDecimals(assetAddress);
    const cleanValue = this.hexToDecimal(rawValue, decimals);
    return {
      txHash: hash,
      fromAddress: from.address,
      toAddress: to.address,
      asset: assetAddress,
      value: cleanValue,
      blockNum: String(blockNum),
      timestamp,
    };
  }

  private extractFromCustomBlockLogs(
    payload: Record<string, unknown>,
  ): CleanTransactionPayload[] {
    const block = payload.block;
    if (!block || typeof block !== 'object') {
      return [];
    }

    const blockData = block as Record<string, unknown>;
    const logs = blockData.logs;
    if (!Array.isArray(logs)) {
      return [];
    }

    const blockTimestamp = this.parseDate(blockData.timestamp) ?? new Date();
    const blockNumberRaw = blockData.number;
    const blockNumber =
      typeof blockNumberRaw === 'number'
        ? String(blockNumberRaw)
        : typeof blockNumberRaw === 'string'
          ? blockNumberRaw
          : undefined;

    const cleanItems: CleanTransactionPayload[] = [];
    for (const log of logs) {
      if (!log || typeof log !== 'object') {
        continue;
      }

      const logData = log as Record<string, unknown>;
      const transaction = logData.transaction;
      if (!transaction || typeof transaction !== 'object') {
        continue;
      }

      const tx = transaction as Record<string, unknown>;
      const hash = tx.hash;
      const from = tx.from as { address?: string } | undefined;
      const to = tx.to as { address?: string } | undefined;
      const account = logData.account as { address?: string } | undefined;
      const rawValue = logData.data;
      const txNonce = tx.nonce;

      let resolvedBlockNum = blockNumber;
      if (!resolvedBlockNum) {
        if (typeof txNonce === 'number') {
          resolvedBlockNum = String(txNonce);
        } else if (typeof txNonce === 'string') {
          resolvedBlockNum = txNonce;
        }
      }

      if (
        typeof hash !== 'string' ||
        typeof from?.address !== 'string' ||
        typeof to?.address !== 'string' ||
        typeof resolvedBlockNum !== 'string'
      ) {
        continue;
      }

      const assetAddress = account?.address ?? 'UNKNOWN_ASSET';
      const decimals = this.getAssetDecimals(assetAddress);
      const cleanValue = this.hexToDecimal(rawValue, decimals);

      cleanItems.push({
        txHash: hash,
        fromAddress: from.address,
        toAddress: to.address,
        asset: assetAddress,
        value: cleanValue,
        blockNum: resolvedBlockNum,
        timestamp: blockTimestamp,
      });
    }

    return cleanItems;
  }

  private parseDate(value: unknown): Date | null {
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  }

  private getAssetDecimals(assetAddress: string): number {
    const normalizedAddress = assetAddress.toLowerCase();
    const defaults: Record<string, number> = {
      // USDC on Ethereum mainnet
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,
      // USDT on Ethereum mainnet
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,
      // WETH on Ethereum mainnet
      '0xc02aa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,
    };

    const decimalsFromEnv = process.env.ASSET_DECIMALS_MAP;
    if (decimalsFromEnv) {
      try {
        const parsed = JSON.parse(decimalsFromEnv) as Record<string, number>;
        const envDecimals = parsed[normalizedAddress];
        if (typeof envDecimals === 'number' && envDecimals >= 0) {
          return envDecimals;
        }
      } catch {
        this.logger.warn(
          'ASSET_DECIMALS_MAP is invalid JSON. Falling back to default decimals map.',
        );
      }
    }

    return defaults[normalizedAddress] ?? 18;
  }

  private hexToDecimal(value: unknown, decimals = 0): number {
    if (typeof value === 'string' && value.startsWith('0x')) {
      const raw = BigInt(value);
      if (decimals <= 0) {
        return Number(raw);
      }

      const divisor = BigInt(10) ** BigInt(decimals);
      const whole = raw / divisor;
      const fraction = raw % divisor;
      const fractionPadded = fraction.toString().padStart(decimals, '0');
      const normalized = `${whole.toString()}.${fractionPadded}`.replace(
        /\.?0+$/,
        '',
      );
      return Number(normalized);
    }
    if (typeof value === 'number') {
      return value;
    }
    return 0;
  }
}
