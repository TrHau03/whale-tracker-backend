/*
  Warnings:

  - You are about to drop the `KafkaOutbox` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "KafkaOutbox" DROP CONSTRAINT "KafkaOutbox_webhookEventId_fkey";

-- AlterTable
ALTER TABLE "WebhookActivity" ADD COLUMN     "accountAddress" TEXT,
ADD COLUMN     "createdContract" TEXT,
ADD COLUMN     "cumulativeGasUsed" INTEGER,
ADD COLUMN     "effectiveGasPrice" TEXT,
ADD COLUMN     "gas" INTEGER,
ADD COLUMN     "gasPrice" TEXT,
ADD COLUMN     "gasUsed" INTEGER,
ADD COLUMN     "maxFeePerGas" TEXT,
ADD COLUMN     "maxPriorityFeePerGas" TEXT,
ADD COLUMN     "txIndex" INTEGER,
ADD COLUMN     "txStatus" INTEGER;

-- DropTable
DROP TABLE "KafkaOutbox";

-- DropEnum
DROP TYPE "KafkaOutboxStatus";

-- CreateIndex
CREATE INDEX "WebhookActivity_accountAddress_idx" ON "WebhookActivity"("accountAddress");
