-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ProductEmbedding: stores text and image embeddings per product
CREATE TABLE "product_embeddings" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "text_embedding" vector(1536),
    "image_embedding" vector(512),
    "combined_embedding" vector(1536),
    "embedding_model" TEXT,
    "input_hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("id")
);

-- GroundTruthProduct: admin-confirmed correct classifications
CREATE TABLE "ground_truth_products" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "gender" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedByUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ground_truth_products_pkey" PRIMARY KEY ("id")
);

-- SubcategoryCentroid: vector centroid per subcategory
CREATE TABLE "subcategory_centroids" (
    "id" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "centroid_embedding" vector(1536),
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "avg_intra_distance" DOUBLE PRECISION,
    "max_intra_distance" DOUBLE PRECISION,
    "std_intra_distance" DOUBLE PRECISION,
    "metrics" JSONB,
    "last_trained_at" TIMESTAMP(3),
    "model_run_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcategory_centroids_pkey" PRIMARY KEY ("id")
);

-- GenderCentroid: vector centroid per gender
CREATE TABLE "gender_centroids" (
    "id" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "centroid_embedding" vector(1536),
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "avg_intra_distance" DOUBLE PRECISION,
    "metrics" JSONB,
    "last_trained_at" TIMESTAMP(3),
    "model_run_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gender_centroids_pkey" PRIMARY KEY ("id")
);

-- VectorModelRun: training run history
CREATE TABLE "vector_model_runs" (
    "id" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalCentroids" INTEGER,
    "totalSamples" INTEGER,
    "metrics" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vector_model_runs_pkey" PRIMARY KEY ("id")
);

-- VectorReclassificationSuggestion: reclassification proposals from vector model
CREATE TABLE "vector_reclassification_suggestions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "fromCategory" TEXT,
    "fromSubcategory" TEXT,
    "fromGender" TEXT,
    "toCategory" TEXT,
    "toSubcategory" TEXT,
    "toGender" TEXT,
    "confidence" DOUBLE PRECISION,
    "vectorDistance" DOUBLE PRECISION,
    "margin" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "runId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vector_reclassification_suggestions_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "product_embeddings_productId_key" ON "product_embeddings"("productId");
CREATE UNIQUE INDEX "ground_truth_products_productId_subcategory_key" ON "ground_truth_products"("productId", "subcategory");
CREATE UNIQUE INDEX "subcategory_centroids_subcategory_key" ON "subcategory_centroids"("subcategory");
CREATE UNIQUE INDEX "gender_centroids_gender_key" ON "gender_centroids"("gender");

-- Standard indexes
CREATE INDEX "ground_truth_products_subcategory_idx" ON "ground_truth_products"("subcategory");
CREATE INDEX "ground_truth_products_category_idx" ON "ground_truth_products"("category");
CREATE INDEX "ground_truth_products_gender_idx" ON "ground_truth_products"("gender");
CREATE INDEX "ground_truth_products_confirmedByUserId_idx" ON "ground_truth_products"("confirmedByUserId");
CREATE INDEX "subcategory_centroids_category_idx" ON "subcategory_centroids"("category");
CREATE INDEX "vector_model_runs_modelType_status_idx" ON "vector_model_runs"("modelType", "status");
CREATE INDEX "vector_model_runs_startedAt_idx" ON "vector_model_runs"("startedAt");
CREATE INDEX "vector_reclassification_suggestions_status_createdAt_idx" ON "vector_reclassification_suggestions"("status", "createdAt");
CREATE INDEX "vector_reclassification_suggestions_productId_status_idx" ON "vector_reclassification_suggestions"("productId", "status");
CREATE INDEX "vector_reclassification_suggestions_modelType_status_idx" ON "vector_reclassification_suggestions"("modelType", "status");
CREATE INDEX "vector_reclassification_suggestions_runId_idx" ON "vector_reclassification_suggestions"("runId");
CREATE INDEX "vector_reclassification_suggestions_decidedByUserId_idx" ON "vector_reclassification_suggestions"("decidedByUserId");

-- Foreign keys
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ground_truth_products" ADD CONSTRAINT "ground_truth_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ground_truth_products" ADD CONSTRAINT "ground_truth_products_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vector_reclassification_suggestions" ADD CONSTRAINT "vector_reclassification_suggestions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vector_reclassification_suggestions" ADD CONSTRAINT "vector_reclassification_suggestions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- pgvector indexes for cosine similarity search (IVFFlat)
-- Note: IVFFlat requires data to build the index properly, so these use a small lists value
-- that can be recreated later with more data for better performance
CREATE INDEX "product_embeddings_text_cosine_idx" ON "product_embeddings" USING ivfflat ("text_embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "product_embeddings_combined_cosine_idx" ON "product_embeddings" USING ivfflat ("combined_embedding" vector_cosine_ops) WITH (lists = 100);
