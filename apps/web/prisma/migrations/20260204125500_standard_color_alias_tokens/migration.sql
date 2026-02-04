-- Add more aliases for frequent tokens/phrases
INSERT INTO "standard_color_aliases" ("alias", "standardColorId", "createdAt", "updatedAt")
SELECT m.alias, sc.id, now(), now()
FROM (
  VALUES
    ('brown','#6F4E37'),
    ('ochre','#D4B896'),
    ('dark navy','#000080'),
    ('dark green','#228B22'),
    ('gray blue','#2C3E50'),
    ('metal green','#50C878'),
    ('royal','#4169E1'),
    ('barn red','#D32F2F'),
    ('new green','#4CAF50'),
    ('multi colored','#808080'),
    ('multicolored','#808080'),
    ('black white','#808080'),
    ('b w','#808080')
) AS m(alias, hex)
JOIN "standard_colors" sc ON sc.hex = m.hex
ON CONFLICT ("alias") DO UPDATE SET
  "standardColorId" = EXCLUDED."standardColorId",
  "updatedAt" = EXCLUDED."updatedAt";

-- Token-aware fallback for non-hex labels
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
  tokens TEXT[];
  token_priority TEXT[] := ARRAY[
    'navy','cobalt','indigo','blue','green','red','pink','purple','magenta',
    'orange','yellow','brown','beige','tan','camel','gray','grey','black','white',
    'gold','silver','copper','bronze'
  ];
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

    tokens := regexp_split_to_array(alias_key, '\\s+');
    SELECT a."standardColorId" INTO standard_color_id
      FROM "standard_color_aliases" a
     WHERE a.alias !~ '\\s'
       AND a.alias = ANY(tokens)
     ORDER BY array_position(token_priority, a.alias) NULLS LAST, a.alias
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

-- Backfill again for variants still missing assignment
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
