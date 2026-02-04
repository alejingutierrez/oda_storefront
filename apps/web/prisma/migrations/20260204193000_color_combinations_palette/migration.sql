-- Add JSON storage for combination colors
ALTER TABLE "color_combinations" ADD COLUMN IF NOT EXISTS "colorsJson" JSONB;

-- Preserve existing combo colors into colorsJson before restructuring
UPDATE "color_combinations" c
SET "colorsJson" = sub.colors
FROM (
  SELECT
    "combinationId",
    jsonb_agg(
      jsonb_build_object(
        'hex', CASE WHEN cc.hex LIKE '#%' THEN UPPER(cc.hex) ELSE '#' || UPPER(cc.hex) END,
        'role', cc.role
      )
      ORDER BY cc.position
    ) AS colors
  FROM "color_combination_colors" cc
  GROUP BY "combinationId"
) AS sub
WHERE c.id = sub."combinationId"
  AND c."colorsJson" IS NULL;

-- Drop old relational shape for color_combination_colors
ALTER TABLE "color_combination_colors"
  DROP CONSTRAINT IF EXISTS "color_combination_colors_combinationId_fkey";

DROP INDEX IF EXISTS "color_combination_colors_combinationId_position_key";
DROP INDEX IF EXISTS "color_combination_colors_combinationId_idx";
DROP INDEX IF EXISTS "color_combination_colors_hex_idx";
DROP INDEX IF EXISTS "color_combination_colors_pantoneCode_idx";

ALTER TABLE "color_combination_colors"
  DROP COLUMN IF EXISTS "combinationId",
  DROP COLUMN IF EXISTS "position",
  DROP COLUMN IF EXISTS "role";

-- Reset table to hold only palette rows
TRUNCATE TABLE "color_combination_colors";

-- Add standard color linkage metadata
ALTER TABLE "color_combination_colors"
  ADD COLUMN IF NOT EXISTS "standardColorId" TEXT,
  ADD COLUMN IF NOT EXISTS "standardColorDistance" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "standardColorAssignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "standardColorSource" TEXT;

ALTER TABLE "color_combination_colors"
  ADD CONSTRAINT "color_combination_colors_standardColorId_fkey"
  FOREIGN KEY ("standardColorId") REFERENCES "standard_colors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "color_combination_colors_hex_key" ON "color_combination_colors"("hex");
CREATE INDEX IF NOT EXISTS "color_combination_colors_standardColorId_idx" ON "color_combination_colors"("standardColorId");
