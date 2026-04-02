export interface AlchemyWebhookEnvelope {
  eventId: string;
  webhookId: string;
  eventType: string;
  createdAt: Date;
  network?: string;
  sequenceNumber?: string;
  rawPayload: Record<string, unknown>;
  activities: NormalizedWebhookActivity[];
}

export interface NormalizedWebhookActivity {
  activityIndex: number;
  sourceKind: string;
  txHash?: string;
  blockNum?: string;
  category?: string;
  fromAddress?: string;
  toAddress?: string;
  assetSymbol?: string;
  assetAddress?: string;
  rawValue?: string;
  value?: string;
  tokenId?: string;
  logIndex?: string;
  removed?: boolean;
  payload: Record<string, unknown>;
}

export interface KafkaWebhookMessage {
  schemaVersion: number;
  source: 'alchemy';
  eventId: string;
  webhookId: string;
  eventType: string;
  network?: string;
  sequenceNumber?: string;
  createdAt: string;
  receivedAt: string;
  activities: KafkaWebhookActivityMessage[];
  rawPayload: Record<string, unknown>;
}

export interface KafkaWebhookActivityMessage {
  activityIndex: number;
  sourceKind: string;
  txHash?: string;
  blockNum?: string;
  category?: string;
  fromAddress?: string;
  toAddress?: string;
  assetSymbol?: string;
  assetAddress?: string;
  rawValue?: string;
  value?: string;
  tokenId?: string;
  logIndex?: string;
  removed?: boolean;
}

export interface WebhookIngestionResult {
  status: 'accepted' | 'duplicate';
  eventId: string;
  activitiesStored: number;
}
