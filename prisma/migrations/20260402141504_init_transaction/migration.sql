-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "blockNum" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "isAnomaly" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" DOUBLE PRECISION,
    "insertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txHash_key" ON "Transaction"("txHash");
