import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { AivenKafkaService } from './kafka/aiven-kafka.service';
import { PrismaService } from './prisma.service';

interface CleanTransactionPayload {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  asset: string;
  value: number;
  blockNum: string;
  timestamp: Date;
}

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
  ): Promise<Record<string, unknown>> {
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

  private extractTransactions(
    payload: Record<string, unknown>,
  ): CleanTransactionPayload[] {
    const createdAtRaw = payload.createdAt;
    const createdAt =
      typeof createdAtRaw === 'string' ? new Date(createdAtRaw) : new Date();

    const transactionsFromEvent = this.extractFromAddressActivity(payload);
    if (transactionsFromEvent.length > 0) {
      return transactionsFromEvent.map((item) => ({
        ...item,
        timestamp: createdAt,
      }));
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
