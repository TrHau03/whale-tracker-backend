import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

type RequestWithRawBody = Request & { rawBody?: string };

@Injectable()
export class AlchemyWebhookAuthService {
  private readonly logger = new Logger(AlchemyWebhookAuthService.name);

  verifyRequest(
    req: RequestWithRawBody,
    payload: Record<string, unknown>,
  ): string | undefined {
    const signingKey = process.env.ALCHEMY_SIGNING_KEY?.trim();
    if (!signingKey) {
      this.logger.warn(
        'ALCHEMY_SIGNING_KEY is not configured. Skipping webhook signature verification.',
      );
      return undefined;
    }

    const incomingSignature = this.extractSignature(req);
    if (!incomingSignature) {
      throw new UnauthorizedException('Missing Alchemy signature');
    }

    const rawPayload = req.rawBody ?? JSON.stringify(payload);
    const expectedSignature = createHmac('sha256', signingKey)
      .update(rawPayload, 'utf8')
      .digest('hex');

    if (!this.secureCompare(expectedSignature, incomingSignature)) {
      throw new UnauthorizedException('Invalid Alchemy signature');
    }

    return incomingSignature;
  }

  private extractSignature(req: RequestWithRawBody): string | null {
    const headerValue = req.headers['x-alchemy-signature'];
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
      return headerValue.trim();
    }

    if (Array.isArray(headerValue) && headerValue[0]?.trim()) {
      return headerValue[0].trim();
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
}
