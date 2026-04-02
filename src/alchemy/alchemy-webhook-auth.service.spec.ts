import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AlchemyWebhookAuthService } from './alchemy-webhook-auth.service';

describe('AlchemyWebhookAuthService', () => {
  const originalSigningKey = process.env.ALCHEMY_SIGNING_KEY;
  let service: AlchemyWebhookAuthService;

  beforeEach(() => {
    process.env.ALCHEMY_SIGNING_KEY = 'whsec_test';
    service = new AlchemyWebhookAuthService();
  });

  afterAll(() => {
    if (originalSigningKey === undefined) {
      delete process.env.ALCHEMY_SIGNING_KEY;
      return;
    }

    process.env.ALCHEMY_SIGNING_KEY = originalSigningKey;
  });

  it('accepts a valid signature generated from the raw request body', () => {
    const rawBody = '{"hello":"world"}';
    const signature = createHmac('sha256', 'whsec_test')
      .update(rawBody, 'utf8')
      .digest('hex');

    const result = service.verifyRequest(
      {
        headers: {
          'x-alchemy-signature': signature,
        },
        rawBody,
      } as never,
      { hello: 'world' },
    );

    expect(result).toBe(signature);
  });

  it('rejects an invalid signature', () => {
    expect(() =>
      service.verifyRequest(
        {
          headers: {
            'x-alchemy-signature': 'invalid',
          },
          rawBody: '{"hello":"world"}',
        } as never,
        { hello: 'world' },
      ),
    ).toThrow(UnauthorizedException);
  });
});
