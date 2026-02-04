-- CreateTable
CREATE TABLE "standard_colors" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "labL" DOUBLE PRECISION NOT NULL,
    "labA" DOUBLE PRECISION NOT NULL,
    "labB" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standard_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_color_config" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standard_color_config_pkey" PRIMARY KEY ("key")
);

-- AlterTable
ALTER TABLE "variants" ADD COLUMN "standardColorId" TEXT;
ALTER TABLE "variants" ADD COLUMN "standardColorDistance" DOUBLE PRECISION;
ALTER TABLE "variants" ADD COLUMN "standardColorAssignedAt" TIMESTAMP(3);
ALTER TABLE "variants" ADD COLUMN "standardColorSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "standard_colors_hex_key" ON "standard_colors"("hex");

-- CreateIndex
CREATE UNIQUE INDEX "standard_colors_family_name_key" ON "standard_colors"("family", "name");

-- CreateIndex
CREATE INDEX "standard_colors_family_idx" ON "standard_colors"("family");

-- CreateIndex
CREATE INDEX "variants_standardColorId_idx" ON "variants"("standardColorId");

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_standardColorId_fkey" FOREIGN KEY ("standardColorId") REFERENCES "standard_colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Helpers
CREATE OR REPLACE FUNCTION normalize_hex(input TEXT)
RETURNS TEXT AS $$
DECLARE
  h TEXT;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;
  h := upper(btrim(input));
  h := regexp_replace(h, '^#', '');
  IF h ~ '^[0-9A-F]{8}$' THEN
    h := substring(h from 1 for 6);
  END IF;
  IF h ~ '^[0-9A-F]{6}$' THEN
    RETURN '#' || h;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION hex_to_lab(input TEXT)
RETURNS TABLE(l DOUBLE PRECISION, a DOUBLE PRECISION, b DOUBLE PRECISION) AS $$
DECLARE
  h TEXT;
  bytes BYTEA;
  r INT;
  g INT;
  bl INT;
  r_s DOUBLE PRECISION;
  g_s DOUBLE PRECISION;
  b_s DOUBLE PRECISION;
  r_lin DOUBLE PRECISION;
  g_lin DOUBLE PRECISION;
  b_lin DOUBLE PRECISION;
  x DOUBLE PRECISION;
  y DOUBLE PRECISION;
  z DOUBLE PRECISION;
  fx DOUBLE PRECISION;
  fy DOUBLE PRECISION;
  fz DOUBLE PRECISION;
BEGIN
  h := normalize_hex(input);
  IF h IS NULL THEN
    l := NULL;
    a := NULL;
    b := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  h := replace(h, '#', '');
  bytes := decode(h, 'hex');
  r := get_byte(bytes, 0);
  g := get_byte(bytes, 1);
  bl := get_byte(bytes, 2);

  r_s := r / 255.0;
  g_s := g / 255.0;
  b_s := bl / 255.0;

  r_lin := CASE WHEN r_s <= 0.04045 THEN r_s / 12.92 ELSE power((r_s + 0.055) / 1.055, 2.4) END;
  g_lin := CASE WHEN g_s <= 0.04045 THEN g_s / 12.92 ELSE power((g_s + 0.055) / 1.055, 2.4) END;
  b_lin := CASE WHEN b_s <= 0.04045 THEN b_s / 12.92 ELSE power((b_s + 0.055) / 1.055, 2.4) END;

  x := r_lin * 0.4124 + g_lin * 0.3576 + b_lin * 0.1805;
  y := r_lin * 0.2126 + g_lin * 0.7152 + b_lin * 0.0722;
  z := r_lin * 0.0193 + g_lin * 0.1192 + b_lin * 0.9505;

  x := x / 0.95047;
  y := y / 1.0;
  z := z / 1.08883;

  fx := CASE WHEN x > 0.008856 THEN power(x, 1.0 / 3.0) ELSE (7.787 * x) + (16.0 / 116.0) END;
  fy := CASE WHEN y > 0.008856 THEN power(y, 1.0 / 3.0) ELSE (7.787 * y) + (16.0 / 116.0) END;
  fz := CASE WHEN z > 0.008856 THEN power(z, 1.0 / 3.0) ELSE (7.787 * z) + (16.0 / 116.0) END;

  l := (116.0 * fy) - 16.0;
  a := 500.0 * (fx - fy);
  b := 200.0 * (fy - fz);

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION hex_saturation(input TEXT)
RETURNS DOUBLE PRECISION AS $$
DECLARE
  h TEXT;
  bytes BYTEA;
  r INT;
  g INT;
  bl INT;
  r_s DOUBLE PRECISION;
  g_s DOUBLE PRECISION;
  b_s DOUBLE PRECISION;
  maxc DOUBLE PRECISION;
  minc DOUBLE PRECISION;
BEGIN
  h := normalize_hex(input);
  IF h IS NULL THEN
    RETURN NULL;
  END IF;
  h := replace(h, '#', '');
  bytes := decode(h, 'hex');
  r := get_byte(bytes, 0);
  g := get_byte(bytes, 1);
  bl := get_byte(bytes, 2);

  r_s := r / 255.0;
  g_s := g / 255.0;
  b_s := bl / 255.0;

  maxc := GREATEST(r_s, g_s, b_s);
  minc := LEAST(r_s, g_s, b_s);

  IF maxc = 0 THEN
    RETURN 0;
  END IF;

  RETURN (maxc - minc) / maxc;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION standard_color_best_match(input TEXT)
RETURNS TABLE(standard_color_id TEXT, distance DOUBLE PRECISION) AS $$
DECLARE
  h TEXT;
  s DOUBLE PRECISION;
  l_val DOUBLE PRECISION;
  a_val DOUBLE PRECISION;
  b_val DOUBLE PRECISION;
  threshold DOUBLE PRECISION := 0.12;
  families TEXT[] := ARRAY['NEUTRAL', 'WARM_NEUTRAL', 'METALLIC'];
  allow_hexes TEXT[] := ARRAY['#C0C0C0'];
  cfg JSONB;
BEGIN
  h := normalize_hex(input);
  IF h IS NULL THEN
    RETURN;
  END IF;

  s := hex_saturation(h);

  SELECT "valueJson" INTO cfg FROM "standard_color_config" WHERE "key" = 'low_saturation_gate';
  IF cfg IS NOT NULL THEN
    threshold := COALESCE((cfg->>'threshold')::double precision, threshold);
    IF jsonb_typeof(cfg->'families') = 'array' THEN
      SELECT array_agg(value) INTO families FROM jsonb_array_elements_text(cfg->'families') AS value;
    END IF;
    IF jsonb_typeof(cfg->'allow_hexes') = 'array' THEN
      SELECT array_agg(value) INTO allow_hexes FROM jsonb_array_elements_text(cfg->'allow_hexes') AS value;
    END IF;
  END IF;

  SELECT l, a, b INTO l_val, a_val, b_val FROM hex_to_lab(h) LIMIT 1;

  IF s IS NOT NULL AND s < threshold THEN
    SELECT sc.id,
           sqrt(power(sc."labL" - l_val, 2) + power(sc."labA" - a_val, 2) + power(sc."labB" - b_val, 2)) AS dist
      INTO standard_color_id, distance
      FROM "standard_colors" sc
     WHERE sc.family = ANY(families)
       AND (sc.family <> 'METALLIC' OR sc.hex = ANY(allow_hexes))
     ORDER BY dist ASC
     LIMIT 1;

    IF standard_color_id IS NOT NULL THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT sc.id,
         sqrt(power(sc."labL" - l_val, 2) + power(sc."labA" - a_val, 2) + power(sc."labB" - b_val, 2)) AS dist
    INTO standard_color_id, distance
    FROM "standard_colors" sc
   ORDER BY dist ASC
   LIMIT 1;

  IF standard_color_id IS NOT NULL THEN
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION variants_set_standard_color()
RETURNS TRIGGER AS $$
DECLARE
  match RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.color IS NOT DISTINCT FROM OLD.color THEN
    RETURN NEW;
  END IF;

  IF NEW.color IS NULL OR btrim(NEW.color) = '' THEN
    NEW."standardColorId" := NULL;
    NEW."standardColorDistance" := NULL;
    NEW."standardColorAssignedAt" := NULL;
    NEW."standardColorSource" := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO match FROM standard_color_best_match(NEW.color) LIMIT 1;

  IF match.standard_color_id IS NULL THEN
    NEW."standardColorId" := NULL;
    NEW."standardColorDistance" := NULL;
  ELSE
    NEW."standardColorId" := match.standard_color_id;
    NEW."standardColorDistance" := match.distance;
  END IF;

  NEW."standardColorAssignedAt" := now();
  NEW."standardColorSource" := 'auto';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS variants_set_standard_color ON "variants";
CREATE TRIGGER variants_set_standard_color
BEFORE INSERT OR UPDATE OF color ON "variants"
FOR EACH ROW EXECUTE FUNCTION variants_set_standard_color();

-- Seed config
INSERT INTO "standard_color_config" ("key", "valueJson", "createdAt", "updatedAt")
VALUES (
  'low_saturation_gate',
  '{"threshold":0.12,"families":["NEUTRAL","WARM_NEUTRAL","METALLIC"],"allow_hexes":["#C0C0C0"]}',
  now(),
  now()
)
ON CONFLICT ("key") DO UPDATE SET
  "valueJson" = EXCLUDED."valueJson",
  "updatedAt" = EXCLUDED."updatedAt";

-- Seed standard colors
INSERT INTO "standard_colors" ("id", "family", "name", "hex", "labL", "labA", "labB", "createdAt", "updatedAt")
SELECT
  md5(v.family || ':' || v.name || ':' || v.hex),
  v.family,
  v.name,
  v.hex,
  lab.l,
  lab.a,
  lab.b,
  now(),
  now()
FROM (
  VALUES
    ('NEUTRAL','Negro','#000000'),
    ('NEUTRAL','Carbon','#1A1A1A'),
    ('NEUTRAL','Grafito','#2C2C2C'),
    ('NEUTRAL','Gris oscuro','#4A4A4A'),
    ('NEUTRAL','Gris','#808080'),
    ('NEUTRAL','Gris claro','#D3D3D3'),
    ('NEUTRAL','Blanco roto','#F5F5F5'),
    ('NEUTRAL','Blanco','#FFFFFF'),
    ('WARM_NEUTRAL','Marfil','#FFFFF0'),
    ('WARM_NEUTRAL','Beige','#F5F5DC'),
    ('WARM_NEUTRAL','Crema','#F5E6D3'),
    ('WARM_NEUTRAL','Lino','#F5F0E8'),
    ('WARM_NEUTRAL','Arena','#E8D5C4'),
    ('WARM_NEUTRAL','Greige','#D4C4A8'),
    ('WARM_NEUTRAL','Avena','#D4C5B0'),
    ('WARM_NEUTRAL','Tan','#D4B896'),
    ('WARM_NEUTRAL','Camel','#C19A6B'),
    ('BROWN','Espresso','#3D2817'),
    ('BROWN','Nogal','#6B4423'),
    ('BROWN','Cafe','#6F4E37'),
    ('BROWN','Siena','#8B4513'),
    ('BROWN','Cuero','#A0522D'),
    ('BROWN','Chocolate','#D2691E'),
    ('METALLIC','Plata','#C0C0C0'),
    ('METALLIC','Oro','#FFD700'),
    ('METALLIC','Oro champana','#D4AF37'),
    ('METALLIC','Cobre','#B87333'),
    ('RED','Rojo','#FF0000'),
    ('RED','Rojo intenso','#D32F2F'),
    ('RED','Carmesi','#DC143C'),
    ('RED','Vino','#722F37'),
    ('PINK','Rosa palido','#F4C2C2'),
    ('PINK','Rosa','#FFC0CB'),
    ('PINK','Rosa fuerte','#FF69B4'),
    ('PINK','Rosa profundo','#FF1493'),
    ('ORANGE','Naranja','#FFA500'),
    ('ORANGE','Naranja oscuro','#FF8C00'),
    ('ORANGE','Coral','#FF7F50'),
    ('ORANGE','Mandarina','#FF6B35'),
    ('YELLOW','Amarillo','#F4D03F'),
    ('GREEN','Oliva','#6B8E23'),
    ('GREEN','Oliva oscuro','#556B2F'),
    ('GREEN','Bosque','#228B22'),
    ('GREEN','Verde','#4CAF50'),
    ('GREEN','Esmeralda','#50C878'),
    ('GREEN','Menta','#90EE90'),
    ('TEAL','Cian oscuro','#008B8B'),
    ('TEAL','Turquesa','#40E0D0'),
    ('BLUE','Azul marino','#000080'),
    ('BLUE','Azul noche','#001F3F'),
    ('BLUE','Azul profundo','#1E3A5F'),
    ('BLUE','Azul pizarra','#2C3E50'),
    ('BLUE','Cobalto','#0047AB'),
    ('BLUE','Azul real','#4169E1'),
    ('BLUE','Azul brillante','#4A90E2'),
    ('BLUE','Azul cielo','#87CEEB'),
    ('PURPLE','Lavanda','#D8BFD8'),
    ('PURPLE','Lila','#C8A2C8'),
    ('PURPLE','Indigo','#4B0082'),
    ('MAGENTA','Magenta','#FF00FF')
) AS v(family, name, hex)
CROSS JOIN LATERAL hex_to_lab(v.hex) AS lab(l, a, b)
ON CONFLICT ("hex") DO UPDATE SET
  "family" = EXCLUDED."family",
  "name" = EXCLUDED."name",
  "labL" = EXCLUDED."labL",
  "labA" = EXCLUDED."labA",
  "labB" = EXCLUDED."labB",
  "updatedAt" = EXCLUDED."updatedAt";

-- Backfill variants
UPDATE "variants" v
SET
  "standardColorId" = s.standard_color_id,
  "standardColorDistance" = s.distance,
  "standardColorAssignedAt" = now(),
  "standardColorSource" = 'auto'
FROM (
  SELECT v2.id, m.standard_color_id, m.distance
  FROM "variants" v2
  JOIN LATERAL standard_color_best_match(v2.color) AS m(standard_color_id, distance) ON true
  WHERE v2.color IS NOT NULL AND btrim(v2.color) <> ''
) AS s
WHERE v.id = s.id;
