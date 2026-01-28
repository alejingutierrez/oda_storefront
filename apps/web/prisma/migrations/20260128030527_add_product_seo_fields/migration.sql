-- AlterTable
ALTER TABLE "products" ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "seoTitle" TEXT;
