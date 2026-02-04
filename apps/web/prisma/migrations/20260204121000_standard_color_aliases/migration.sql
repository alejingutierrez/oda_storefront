-- CreateTable
CREATE TABLE "standard_color_aliases" (
    "alias" TEXT NOT NULL,
    "standardColorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standard_color_aliases_pkey" PRIMARY KEY ("alias")
);

-- CreateIndex
CREATE INDEX "standard_color_aliases_standardColorId_idx" ON "standard_color_aliases"("standardColorId");

-- AddForeignKey
ALTER TABLE "standard_color_aliases" ADD CONSTRAINT "standard_color_aliases_standardColorId_fkey" FOREIGN KEY ("standardColorId") REFERENCES "standard_colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Helpers
CREATE OR REPLACE FUNCTION normalize_color_label(input TEXT)
RETURNS TEXT AS $$
DECLARE
  t TEXT;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;
  t := lower(btrim(input));
  t := translate(t, 'áéíóúüñ', 'aeiouun');
  t := regexp_replace(t, '[^a-z]+', ' ', 'g');
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := btrim(t);
  RETURN t;
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
  alias_key TEXT;
BEGIN
  h := normalize_hex(input);
  IF h IS NULL THEN
    alias_key := normalize_color_label(input);
    IF alias_key IS NULL OR alias_key = '' THEN
      RETURN;
    END IF;
    SELECT a."standardColorId" INTO standard_color_id
      FROM "standard_color_aliases" a
     WHERE a.alias = alias_key
     LIMIT 1;
    IF standard_color_id IS NOT NULL THEN
      distance := NULL;
      RETURN NEXT;
    END IF;
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
  hex_norm TEXT;
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

  hex_norm := normalize_hex(NEW.color);
  SELECT * INTO match FROM standard_color_best_match(NEW.color) LIMIT 1;

  IF match.standard_color_id IS NULL THEN
    NEW."standardColorId" := NULL;
    NEW."standardColorDistance" := NULL;
    NEW."standardColorAssignedAt" := now();
    NEW."standardColorSource" := NULL;
    RETURN NEW;
  END IF;

  NEW."standardColorId" := match.standard_color_id;
  NEW."standardColorDistance" := match.distance;
  NEW."standardColorAssignedAt" := now();
  NEW."standardColorSource" := CASE WHEN hex_norm IS NULL THEN 'alias' ELSE 'auto' END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Seed aliases
INSERT INTO "standard_color_aliases" ("alias", "standardColorId", "createdAt", "updatedAt")
SELECT m.alias, sc.id, now(), now()
FROM (
  VALUES
    ('negro','#000000'),
    ('black','#000000'),
    ('carbon','#1A1A1A'),
    ('charcoal','#1A1A1A'),
    ('grafito','#2C2C2C'),
    ('graphite','#2C2C2C'),
    ('gris oscuro','#4A4A4A'),
    ('dark gray','#4A4A4A'),
    ('dark grey','#4A4A4A'),
    ('gris','#808080'),
    ('gray','#808080'),
    ('grey','#808080'),
    ('gris claro','#D3D3D3'),
    ('light gray','#D3D3D3'),
    ('light grey','#D3D3D3'),
    ('blanco roto','#F5F5F5'),
    ('off white','#F5F5F5'),
    ('offwhite','#F5F5F5'),
    ('blanco','#FFFFFF'),
    ('white','#FFFFFF'),
    ('marfil','#FFFFF0'),
    ('ivory','#FFFFF0'),
    ('beige','#F5F5DC'),
    ('crema','#F5E6D3'),
    ('cream','#F5E6D3'),
    ('lino','#F5F0E8'),
    ('linen','#F5F0E8'),
    ('arena','#E8D5C4'),
    ('sand','#E8D5C4'),
    ('greige','#D4C4A8'),
    ('avena','#D4C5B0'),
    ('oat','#D4C5B0'),
    ('tan','#D4B896'),
    ('camel','#C19A6B'),
    ('espresso','#3D2817'),
    ('nogal','#6B4423'),
    ('walnut','#6B4423'),
    ('cafe','#6F4E37'),
    ('coffee','#6F4E37'),
    ('siena','#8B4513'),
    ('sienna','#8B4513'),
    ('cuero','#A0522D'),
    ('leather','#A0522D'),
    ('chocolate','#D2691E'),
    ('plata','#C0C0C0'),
    ('silver','#C0C0C0'),
    ('oro','#FFD700'),
    ('gold','#FFD700'),
    ('oro champana','#D4AF37'),
    ('champagne gold','#D4AF37'),
    ('cobre','#B87333'),
    ('copper','#B87333'),
    ('rojo','#FF0000'),
    ('red','#FF0000'),
    ('rojo intenso','#D32F2F'),
    ('carmesi','#DC143C'),
    ('crimson','#DC143C'),
    ('vino','#722F37'),
    ('vinotinto','#722F37'),
    ('burgundy','#722F37'),
    ('maroon','#722F37'),
    ('wine','#722F37'),
    ('rosa palido','#F4C2C2'),
    ('pale pink','#F4C2C2'),
    ('light pink','#F4C2C2'),
    ('rosa','#FFC0CB'),
    ('pink','#FFC0CB'),
    ('rosado','#FFC0CB'),
    ('rosa fuerte','#FF69B4'),
    ('hot pink','#FF69B4'),
    ('rosa profundo','#FF1493'),
    ('deep pink','#FF1493'),
    ('fucsia','#FF00FF'),
    ('magenta','#FF00FF'),
    ('naranja','#FFA500'),
    ('orange','#FFA500'),
    ('naranja oscuro','#FF8C00'),
    ('dark orange','#FF8C00'),
    ('coral','#FF7F50'),
    ('mandarina','#FF6B35'),
    ('tangerine','#FF6B35'),
    ('amarillo','#F4D03F'),
    ('yellow','#F4D03F'),
    ('oliva','#6B8E23'),
    ('olive','#6B8E23'),
    ('oliva oscuro','#556B2F'),
    ('dark olive','#556B2F'),
    ('bosque','#228B22'),
    ('forest green','#228B22'),
    ('verde','#4CAF50'),
    ('green','#4CAF50'),
    ('esmeralda','#50C878'),
    ('emerald','#50C878'),
    ('menta','#90EE90'),
    ('mint','#90EE90'),
    ('cian oscuro','#008B8B'),
    ('dark cyan','#008B8B'),
    ('turquesa','#40E0D0'),
    ('turquoise','#40E0D0'),
    ('azul marino','#000080'),
    ('navy','#000080'),
    ('navy blue','#000080'),
    ('azul noche','#001F3F'),
    ('midnight blue','#001F3F'),
    ('azul profundo','#1E3A5F'),
    ('deep blue','#1E3A5F'),
    ('dark blue','#1E3A5F'),
    ('azul pizarra','#2C3E50'),
    ('slate blue','#2C3E50'),
    ('cobalto','#0047AB'),
    ('cobalt','#0047AB'),
    ('azul real','#4169E1'),
    ('royal blue','#4169E1'),
    ('azul brillante','#4A90E2'),
    ('bright blue','#4A90E2'),
    ('azul cielo','#87CEEB'),
    ('sky blue','#87CEEB'),
    ('light blue','#87CEEB'),
    ('baby blue','#87CEEB'),
    ('lavanda','#D8BFD8'),
    ('lavender','#D8BFD8'),
    ('lila','#C8A2C8'),
    ('lilac','#C8A2C8'),
    ('indigo','#4B0082')
) AS m(alias, hex)
JOIN "standard_colors" sc ON sc.hex = m.hex
ON CONFLICT ("alias") DO UPDATE SET
  "standardColorId" = EXCLUDED."standardColorId",
  "updatedAt" = EXCLUDED."updatedAt";

-- Backfill aliases for variants missing assignment
UPDATE "variants" v
SET
  "standardColorId" = s.standard_color_id,
  "standardColorDistance" = s.distance,
  "standardColorAssignedAt" = now(),
  "standardColorSource" = CASE WHEN normalize_hex(v.color) IS NULL THEN 'alias' ELSE 'auto' END
FROM (
  SELECT v2.id, m.standard_color_id, m.distance
  FROM "variants" v2
  JOIN LATERAL standard_color_best_match(v2.color) AS m(standard_color_id, distance) ON true
  WHERE v2.color IS NOT NULL AND btrim(v2.color) <> '' AND v2."standardColorId" IS NULL
) AS s
WHERE v.id = s.id;
