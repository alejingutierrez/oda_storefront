-- Seed additional aliases
INSERT INTO "standard_color_aliases" ("alias", "standardColorId", "createdAt", "updatedAt")
SELECT m.alias, sc.id, now(), now()
FROM (
  VALUES
    ('azul','#4A90E2'),
    ('blue','#4A90E2'),
    ('azul brillante','#4A90E2'),
    ('azul claro','#87CEEB'),
    ('celeste','#87CEEB'),
    ('turquoise blue','#40E0D0'),
    ('cian','#40E0D0'),
    ('cian claro','#40E0D0'),
    ('purple','#C8A2C8'),
    ('morado','#C8A2C8'),
    ('violeta','#C8A2C8'),
    ('fuchsia','#FF00FF'),
    ('neon green','#4CAF50'),
    ('verde neon','#4CAF50'),
    ('kaki','#D4B896'),
    ('khaki','#D4B896'),
    ('caqui','#D4B896'),
    ('earth brown','#6F4E37'),
    ('tobacco brown','#6F4E37'),
    ('piel','#F5F5DC'),
    ('skin','#F5F5DC'),
    ('print','#808080'),
    ('printed','#808080'),
    ('estampado','#808080'),
    ('estampado azul','#4A90E2'),
    ('multicolor','#808080'),
    ('multi color','#808080'),
    ('brisa tangerine','#FF6B35'),
    ('tangerine','#FF6B35'),
    ('brisa raspberry','#FF1493'),
    ('raspberry','#FF1493'),
    ('brisa emerald','#50C878'),
    ('emerald','#50C878'),
    ('jade','#50C878'),
    ('jade oasis','#50C878'),
    ('wild foliage','#228B22'),
    ('wild folliage','#228B22'),
    ('tropical wine','#722F37'),
    ('sunrise palm','#F4D03F'),
    ('safari','#C19A6B'),
    ('safari mai','#C19A6B')
) AS m(alias, hex)
JOIN "standard_colors" sc ON sc.hex = m.hex
ON CONFLICT ("alias") DO UPDATE SET
  "standardColorId" = EXCLUDED."standardColorId",
  "updatedAt" = EXCLUDED."updatedAt";

-- Backfill aliases for variants still missing assignment
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
