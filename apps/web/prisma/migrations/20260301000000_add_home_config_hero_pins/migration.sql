-- CreateTable
CREATE TABLE "home_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "home_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "home_hero_pins" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_hero_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "home_hero_pins_active_position_idx" ON "home_hero_pins"("active", "position");

-- CreateIndex
CREATE INDEX "home_hero_pins_productId_idx" ON "home_hero_pins"("productId");

-- AddForeignKey
ALTER TABLE "home_hero_pins" ADD CONSTRAINT "home_hero_pins_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
