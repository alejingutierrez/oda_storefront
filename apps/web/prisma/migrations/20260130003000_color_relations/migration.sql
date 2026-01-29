-- AlterTable
ALTER TABLE "color_combination_colors" ADD COLUMN "labL" DOUBLE PRECISION;
ALTER TABLE "color_combination_colors" ADD COLUMN "labA" DOUBLE PRECISION;
ALTER TABLE "color_combination_colors" ADD COLUMN "labB" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "variant_color_vectors" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "hex" TEXT NOT NULL,
    "labL" DOUBLE PRECISION NOT NULL,
    "labA" DOUBLE PRECISION NOT NULL,
    "labB" DOUBLE PRECISION NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_color_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_color_combination_matches" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "combinationId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "avgDistance" DOUBLE PRECISION NOT NULL,
    "maxDistance" DOUBLE PRECISION NOT NULL,
    "matchedColors" INTEGER NOT NULL,
    "totalComboColors" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_color_combination_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "variant_color_vectors_variantId_position_key" ON "variant_color_vectors"("variantId", "position");

-- CreateIndex
CREATE INDEX "variant_color_vectors_variantId_idx" ON "variant_color_vectors"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "variant_color_combination_matches_variantId_combinationId_key" ON "variant_color_combination_matches"("variantId", "combinationId");

-- CreateIndex
CREATE INDEX "variant_color_combination_matches_variantId_idx" ON "variant_color_combination_matches"("variantId");

-- CreateIndex
CREATE INDEX "variant_color_combination_matches_combinationId_idx" ON "variant_color_combination_matches"("combinationId");

-- AddForeignKey
ALTER TABLE "variant_color_vectors" ADD CONSTRAINT "variant_color_vectors_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_color_combination_matches" ADD CONSTRAINT "variant_color_combination_matches_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_color_combination_matches" ADD CONSTRAINT "variant_color_combination_matches_combinationId_fkey" FOREIGN KEY ("combinationId") REFERENCES "color_combinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
