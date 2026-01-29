-- CreateTable
CREATE TABLE "color_combinations" (
    "id" TEXT NOT NULL,
    "imageFilename" TEXT NOT NULL,
    "detectedLayout" TEXT NOT NULL,
    "comboKey" TEXT NOT NULL,
    "season" TEXT,
    "temperature" TEXT,
    "contrast" TEXT,
    "mood" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "color_combinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "color_combination_colors" (
    "id" TEXT NOT NULL,
    "combinationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT,
    "hex" TEXT NOT NULL,
    "pantoneCode" TEXT,
    "pantoneName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "color_combination_colors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "color_combinations_imageFilename_comboKey_key" ON "color_combinations"("imageFilename", "comboKey");

-- CreateIndex
CREATE INDEX "color_combinations_detectedLayout_idx" ON "color_combinations"("detectedLayout");

-- CreateIndex
CREATE INDEX "color_combinations_season_idx" ON "color_combinations"("season");

-- CreateIndex
CREATE INDEX "color_combinations_temperature_idx" ON "color_combinations"("temperature");

-- CreateIndex
CREATE UNIQUE INDEX "color_combination_colors_combinationId_position_key" ON "color_combination_colors"("combinationId", "position");

-- CreateIndex
CREATE INDEX "color_combination_colors_combinationId_idx" ON "color_combination_colors"("combinationId");

-- CreateIndex
CREATE INDEX "color_combination_colors_hex_idx" ON "color_combination_colors"("hex");

-- CreateIndex
CREATE INDEX "color_combination_colors_pantoneCode_idx" ON "color_combination_colors"("pantoneCode");

-- AddForeignKey
ALTER TABLE "color_combination_colors" ADD CONSTRAINT "color_combination_colors_combinationId_fkey" FOREIGN KEY ("combinationId") REFERENCES "color_combinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
