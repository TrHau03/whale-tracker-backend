import { AlchemyWebhookNormalizerService } from './alchemy-webhook-normalizer.service';

describe('AlchemyWebhookNormalizerService', () => {
  let service: AlchemyWebhookNormalizerService;

  beforeEach(() => {
    service = new AlchemyWebhookNormalizerService();
  });

  it('normalizes ADDRESS_ACTIVITY payloads using the documented event.activity shape', () => {
    const result = service.normalize({
      webhookId: 'wh_k63lg72rxda78gce',
      id: 'whevt_vq499kv7elmlbp2v',
      createdAt: '2024-01-23T07:42:26.411977228Z',
      type: 'ADDRESS_ACTIVITY',
      event: {
        network: 'ETH_MAINNET',
        activity: [
          {
            blockNum: '0xdf34a3',
            hash: '0xhash',
            fromAddress: '0xfrom',
            toAddress: '0xto',
            value: 293.092129,
            asset: 'USDC',
            category: 'token',
            rawContract: {
              rawValue:
                '0x0000000000000000000000000000000000000000000000000000000011783b21',
              address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 6,
            },
            log: {
              logIndex: '0x6e',
              removed: false,
            },
          },
        ],
      },
    });

    expect(result.eventType).toBe('ADDRESS_ACTIVITY');
    expect(result.network).toBe('ETH_MAINNET');
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({
      activityIndex: 0,
      txHash: '0xhash',
      fromAddress: '0xfrom',
      toAddress: '0xto',
      assetSymbol: 'USDC',
      assetAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      value: '293.092129',
      logIndex: '0x6e',
      removed: false,
    });
  });

  it('normalizes GRAPHQL payloads from event.data.block.logs', () => {
    const result = service.normalize({
      webhookId: 'wh_custom',
      id: 'whevt_custom',
      createdAt: '2024-01-23T07:51:07.945953790Z',
      type: 'GRAPHQL',
      event: {
        sequenceNumber: '10000000000578619000',
        data: {
          block: {
            number: '0xdf34a3',
            logs: [
              {
                transaction: {
                  hash: '0xtxhash',
                  from: {
                    address: '0xfrom',
                  },
                  to: {
                    address: '0xto',
                  },
                  logs: [
                    {
                      account: {
                        address: '0xcontract',
                      },
                      data: '0x10',
                      index: 239,
                      removed: false,
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    expect(result.sequenceNumber).toBe('10000000000578619000');
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({
      sourceKind: 'GRAPHQL_LOG',
      txHash: '0xtxhash',
      fromAddress: '0xfrom',
      toAddress: '0xto',
      assetAddress: '0xcontract',
      rawValue: '0x10',
      blockNum: '0xdf34a3',
      logIndex: '239',
      removed: false,
    });
  });
});
