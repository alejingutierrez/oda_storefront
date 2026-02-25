ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "real_style" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_real_style_check'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_real_style_check"
      CHECK (
        "real_style" IS NULL
        OR "real_style" IN (
          '01_minimalismo_neutro_pulido',
          '17_street_clean',
          '30_tropi_boho_playa',
          '21_gym_funcional',
          '15_invitado_evento',
          '28_artesanal_contemporaneo',
          '09_coastal_preppy',
          '50_cozy_homewear'
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "products_real_style_idx"
  ON "products"("real_style");
