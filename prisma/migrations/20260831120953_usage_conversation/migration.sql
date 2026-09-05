-- AlterTable
ALTER TABLE "Usage" ADD COLUMN     "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "Usage_conversationId_idx" ON "Usage"("conversationId");

