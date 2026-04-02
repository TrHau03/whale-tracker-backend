-- CreateEnum
CREATE TYPE "KafkaOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "network" TEXT,
    "sequenceNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature" TEXT,
    "rawBody" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookActivity" (
    "id" TEXT NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "activityIndex" INTEGER NOT NULL,
    "txHash" TEXT,
    "blockNum" TEXT,
    "category" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "assetSymbol" TEXT,
    "assetAddress" TEXT,
    "rawValue" TEXT,
    "value" DECIMAL(78,18),
    "tokenId" TEXT,
    "logIndex" TEXT,
    "removed" BOOLEAN,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KafkaOutbox" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "messageKey" TEXT,
    "payload" JSONB NOT NULL,
    "status" "KafkaOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "webhookEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KafkaOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_webhookId_createdAt_idx" ON "WebhookEvent"("webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventType_createdAt_idx" ON "WebhookEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookActivity_webhookEventId_activityIndex_key" ON "WebhookActivity"("webhookEventId", "activityIndex");

-- CreateIndex
CREATE INDEX "WebhookActivity_txHash_idx" ON "WebhookActivity"("txHash");

-- CreateIndex
CREATE INDEX "WebhookActivity_blockNum_idx" ON "WebhookActivity"("blockNum");

-- CreateIndex
CREATE INDEX "WebhookActivity_assetAddress_idx" ON "WebhookActivity"("assetAddress");

-- CreateIndex
CREATE UNIQUE INDEX "KafkaOutbox_dedupeKey_key" ON "KafkaOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "KafkaOutbox_status_availableAt_createdAt_idx" ON "KafkaOutbox"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "KafkaOutbox_webhookEventId_idx" ON "KafkaOutbox"("webhookEventId");

-- AddForeignKey
ALTER TABLE "WebhookActivity" ADD CONSTRAINT "WebhookActivity_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KafkaOutbox" ADD CONSTRAINT "KafkaOutbox_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
