-- AlterTable
ALTER TABLE "users" ADD COLUMN     "descopeUserId" TEXT;
ALTER TABLE "users" ADD COLUMN     "displayName" TEXT;
ALTER TABLE "users" ADD COLUMN     "fullName" TEXT;
ALTER TABLE "users" ADD COLUMN     "bio" TEXT;
ALTER TABLE "users" ADD COLUMN     "avatarUrl" TEXT;
ALTER TABLE "users" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN     "locale" TEXT;
ALTER TABLE "users" ADD COLUMN     "timezone" TEXT;
ALTER TABLE "users" ADD COLUMN     "experienceSubjectId" TEXT;

-- CreateTable
CREATE TABLE "experience_subjects" (
    "id" TEXT NOT NULL,
    "anonId" TEXT NOT NULL,
    "traits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "experience_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_events" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "userId" TEXT,
    "brandId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "listId" TEXT,
    "sessionId" TEXT,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "referrer" TEXT,
    "utm" JSONB,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experience_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_lists" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "slug" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_list_items" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_audit_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_descopeUserId_key" ON "users"("descopeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "experience_subjects_anonId_key" ON "experience_subjects"("anonId");

-- CreateIndex
CREATE INDEX "experience_events_subjectId_idx" ON "experience_events"("subjectId");
CREATE INDEX "experience_events_userId_idx" ON "experience_events"("userId");
CREATE INDEX "experience_events_brandId_idx" ON "experience_events"("brandId");
CREATE INDEX "experience_events_productId_idx" ON "experience_events"("productId");
CREATE INDEX "experience_events_variantId_idx" ON "experience_events"("variantId");
CREATE INDEX "experience_events_listId_idx" ON "experience_events"("listId");
CREATE INDEX "experience_events_sessionId_idx" ON "experience_events"("sessionId");
CREATE INDEX "experience_events_type_idx" ON "experience_events"("type");
CREATE INDEX "experience_events_createdAt_idx" ON "experience_events"("createdAt");

CREATE UNIQUE INDEX "user_identities_provider_providerUserId_key" ON "user_identities"("provider", "providerUserId");
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");

CREATE UNIQUE INDEX "user_favorites_userId_productId_variantId_key" ON "user_favorites"("userId", "productId", "variantId");
CREATE INDEX "user_favorites_userId_idx" ON "user_favorites"("userId");
CREATE INDEX "user_favorites_productId_idx" ON "user_favorites"("productId");
CREATE INDEX "user_favorites_variantId_idx" ON "user_favorites"("variantId");

CREATE UNIQUE INDEX "user_lists_slug_key" ON "user_lists"("slug");
CREATE INDEX "user_lists_userId_idx" ON "user_lists"("userId");

CREATE UNIQUE INDEX "user_list_items_listId_productId_variantId_key" ON "user_list_items"("listId", "productId", "variantId");
CREATE INDEX "user_list_items_listId_idx" ON "user_list_items"("listId");
CREATE INDEX "user_list_items_productId_idx" ON "user_list_items"("productId");
CREATE INDEX "user_list_items_variantId_idx" ON "user_list_items"("variantId");

CREATE INDEX "user_audit_events_userId_idx" ON "user_audit_events"("userId");
CREATE INDEX "user_audit_events_action_idx" ON "user_audit_events"("action");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_experienceSubjectId_fkey" FOREIGN KEY ("experienceSubjectId") REFERENCES "experience_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "experience_events" ADD CONSTRAINT "experience_events_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "experience_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "experience_events" ADD CONSTRAINT "experience_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "experience_events" ADD CONSTRAINT "experience_events_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "experience_events" ADD CONSTRAINT "experience_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "experience_events" ADD CONSTRAINT "experience_events_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "experience_events" ADD CONSTRAINT "experience_events_listId_fkey" FOREIGN KEY ("listId") REFERENCES "user_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_lists" ADD CONSTRAINT "user_lists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_list_items" ADD CONSTRAINT "user_list_items_listId_fkey" FOREIGN KEY ("listId") REFERENCES "user_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_list_items" ADD CONSTRAINT "user_list_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_list_items" ADD CONSTRAINT "user_list_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_audit_events" ADD CONSTRAINT "user_audit_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
