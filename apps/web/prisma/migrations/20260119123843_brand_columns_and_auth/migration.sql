-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "avgPrice" DECIMAL(12,2),
ADD COLUMN     "category" TEXT,
ADD COLUMN     "market" TEXT,
ADD COLUMN     "productCategory" TEXT,
ADD COLUMN     "reviewed" TEXT,
ADD COLUMN     "scale" TEXT,
ADD COLUMN     "sourceFile" TEXT,
ADD COLUMN     "sourceSheet" TEXT,
ADD COLUMN     "style" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "sessionTokenCreatedAt" TIMESTAMP(3),
ADD COLUMN     "sessionTokenHash" TEXT;
