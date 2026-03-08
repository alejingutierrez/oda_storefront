import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ADMIN_TOKEN: z.string().min(1, "ADMIN_TOKEN is required"),
  NEXT_PUBLIC_DESCOPE_PROJECT_ID: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  REDIS_URL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
});

let validated = false;

export function validateEnv() {
  if (validated) return;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${missing}`);
  }

  validated = true;
}
