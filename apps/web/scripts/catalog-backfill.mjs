import pg from "pg";
import crypto from "node:crypto";

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

if (!connectionString) {
  console.error("Missing DATABASE_URL/POSTGRES_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const safeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const safeJson = (value) => {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const main = async () => {
  await client.connect();
  const brands = await client.query(
    "select id, metadata from brands where metadata ? 'catalog_extract'",
  );

  let createdRuns = 0;
  let createdItems = 0;

  for (const row of brands.rows) {
    const brandId = row.id;
    const metadata = row.metadata ?? {};
    const state = metadata.catalog_extract;
    if (!state || !Array.isArray(state.refs)) continue;

    const existing = await client.query(
      'select id from catalog_runs where "brandId"=$1 limit 1',
      [brandId],
    );
    if (existing.rows.length) continue;

    const totalItems = state.refs.length;
    const runStatus = state.status ?? "processing";

    const runId = crypto.randomUUID();
    const runInsert = await client.query(
      `insert into catalog_runs
      ("id", "brandId", "status", "platform", "totalItems", "startedAt", "updatedAt", "finishedAt", "lastError", "blockReason", "lastUrl", "lastStage", "consecutiveErrors", "errorSamples")
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning id`,
      [
        runId,
        brandId,
        runStatus,
        state.platform ?? null,
        totalItems,
        safeDate(state.startedAt) ?? new Date().toISOString(),
        safeDate(state.updatedAt) ?? new Date().toISOString(),
        runStatus === "completed" ? safeDate(state.updatedAt) : null,
        state.lastError ?? null,
        state.blockReason ?? null,
        state.lastUrl ?? null,
        state.lastStage ?? null,
        state.consecutiveErrors ?? 0,
        null,
      ],
    );

    const insertedRunId = runInsert.rows[0]?.id ?? runId;
    if (!insertedRunId) continue;
    createdRuns += 1;

    const items = state.refs.map((ref) => {
      const item = state.items?.[ref.url] ?? {};
      return {
        id: crypto.randomUUID(),
        url: ref.url,
        status: item.status ?? "pending",
        attempts: item.attempts ?? 0,
        lastError: item.lastError ?? null,
        lastStage: item.lastStage ?? null,
        startedAt: safeDate(item.updatedAt) ?? null,
        completedAt: safeDate(item.completedAt) ?? null,
        updatedAt: safeDate(item.updatedAt) ?? new Date().toISOString(),
      };
    });

    for (const batch of chunk(items, 500)) {
      const values = [];
      const placeholders = batch
        .map((item, index) => {
          const offset = index * 10;
          values.push(
            item.id,
            insertedRunId,
            item.url,
            item.status,
            item.attempts,
            item.lastError,
            item.lastStage,
            item.startedAt,
            item.completedAt,
            item.updatedAt,
          );
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`;
        })
        .join(",");

      const insertSql = `insert into catalog_items
        ("id", "runId", "url", "status", "attempts", "lastError", "lastStage", "startedAt", "completedAt", "updatedAt")
        values ${placeholders}
        on conflict ("runId", "url") do nothing`;

      await client.query(insertSql, values);
      createdItems += batch.length;
    }
  }

  await client.end();
  console.log(`Backfill completo. Runs: ${createdRuns}, Items: ${createdItems}`);
};

main().catch((err) => {
  console.error("Backfill error", err);
  process.exit(1);
});
