import path from "node:path";
import dotenv from "dotenv";

// Load repo-root env so Prisma can connect when running this script locally.
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") });

const asBool = (value: string | undefined, fallback: boolean) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const asPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const main = async () => {
  const limit = asPositiveInt(process.env.TAXONOMY_REMAP_SEED_LIMIT, 10_000);
  const maxPasses = asPositiveInt(process.env.TAXONOMY_REMAP_SEED_MAX_PASSES, 400);
  const force = asBool(process.env.TAXONOMY_REMAP_SEED_FORCE, true);

  let cursorId = toText(process.env.TAXONOMY_REMAP_SEED_CURSOR_ID);

  const { runTaxonomyAutoReseedBatch } = await import("../src/lib/taxonomy-remap/auto-reseed");

  console.log(
    JSON.stringify(
      {
        mode: "seed_missing_pending",
        force,
        limit,
        maxPasses,
        cursorId: cursorId || null,
      },
      null,
      2,
    ),
  );

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const prevCursor = cursorId || null;
    const result = await runTaxonomyAutoReseedBatch({
      trigger: "manual",
      force,
      limit,
      mode: "seed_missing_pending",
      ...(cursorId ? { cursorId } : {}),
    });

    const nextCursor = typeof result.nextCursorId === "string" ? result.nextCursorId : null;
    console.log(JSON.stringify({ pass, prevCursorId: prevCursor, result, nextCursorId: nextCursor }, null, 2));

    if (!result.scanned || result.scanned <= 0) break;
    if (!nextCursor) break;
    if (nextCursor === prevCursor) {
      console.error("Cursor did not advance; aborting to avoid infinite loop.");
      break;
    }

    cursorId = nextCursor;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

