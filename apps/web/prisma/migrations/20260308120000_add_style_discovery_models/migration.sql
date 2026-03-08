-- CreateTable
CREATE TABLE "style_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "preferences" JSONB,
    "itemCount" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "style_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_interactions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timeSpentMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "style_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_style_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coherenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_style_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "style_sessions_userId_idx" ON "style_sessions"("userId");

-- CreateIndex
CREATE INDEX "style_sessions_status_createdAt_idx" ON "style_sessions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "style_interactions_sessionId_idx" ON "style_interactions"("sessionId");

-- CreateIndex
CREATE INDEX "style_interactions_productId_idx" ON "style_interactions"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "user_style_profiles_userId_key" ON "user_style_profiles"("userId");

-- CreateIndex
CREATE INDEX "user_style_profiles_userId_idx" ON "user_style_profiles"("userId");

-- AddForeignKey
ALTER TABLE "style_sessions" ADD CONSTRAINT "style_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_interactions" ADD CONSTRAINT "style_interactions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "style_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_interactions" ADD CONSTRAINT "style_interactions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_style_profiles" ADD CONSTRAINT "user_style_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
