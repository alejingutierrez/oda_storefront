import { Prisma } from "@prisma/client";

export function isPrismaTableMissingError(error: unknown, tableName: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2021") return false;

  const normalized = tableName.toLowerCase();
  const metaTable = typeof error.meta?.table === "string" ? error.meta.table.toLowerCase() : "";
  if (metaTable.includes(normalized)) return true;

  return String(error.message ?? "").toLowerCase().includes(normalized);
}
