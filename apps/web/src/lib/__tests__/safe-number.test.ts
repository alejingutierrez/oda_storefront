import { describe, it, expect } from "vitest";
import { safeNumber, safeInt, safeEnvNumber, safeEnvInt } from "../safe-number";

describe("safeNumber", () => {
  it("returns parsed number for valid numeric string", () => {
    expect(safeNumber("42", { fallback: 0 })).toBe(42);
    expect(safeNumber("3.14", { fallback: 0 })).toBe(3.14);
    expect(safeNumber("-7", { fallback: 0 })).toBe(-7);
  });

  it("returns parsed number for numeric values", () => {
    expect(safeNumber(42, { fallback: 0 })).toBe(42);
    expect(safeNumber(0, { fallback: 10 })).toBe(0);
  });

  it("returns fallback for NaN-producing inputs", () => {
    expect(safeNumber("not_a_number", { fallback: 10 })).toBe(10);
    expect(safeNumber(undefined, { fallback: 5 })).toBe(5);
    expect(safeNumber("abc", { fallback: 99 })).toBe(99);
  });

  it("treats null and empty string as 0 (Number coercion)", () => {
    // Number(null) === 0 and Number("") === 0, both finite → returns 0
    expect(safeNumber(null, { fallback: 5 })).toBe(0);
    expect(safeNumber("", { fallback: 5 })).toBe(0);
  });

  it("returns fallback for Infinity", () => {
    expect(safeNumber(Infinity, { fallback: 10 })).toBe(10);
    expect(safeNumber(-Infinity, { fallback: 10 })).toBe(10);
  });

  it("clamps to min", () => {
    expect(safeNumber(-5, { fallback: 0, min: 1 })).toBe(1);
    expect(safeNumber("0", { fallback: 10, min: 1 })).toBe(1);
  });

  it("clamps to max", () => {
    expect(safeNumber(100, { fallback: 0, max: 50 })).toBe(50);
  });

  it("clamps to both min and max", () => {
    expect(safeNumber(100, { fallback: 0, min: 1, max: 50 })).toBe(50);
    expect(safeNumber(-5, { fallback: 0, min: 1, max: 50 })).toBe(1);
  });

  it("uses fallback when NaN, then clamps", () => {
    expect(safeNumber("bad", { fallback: 0, min: 5 })).toBe(5);
    expect(safeNumber("bad", { fallback: 100, max: 50 })).toBe(50);
  });
});

describe("safeInt", () => {
  it("floors the result", () => {
    expect(safeInt(3.7, { fallback: 0 })).toBe(3);
    expect(safeInt("3.9", { fallback: 0 })).toBe(3);
    expect(safeInt(-1.2, { fallback: 0 })).toBe(-2);
  });

  it("returns floored fallback for NaN", () => {
    expect(safeInt("bad", { fallback: 5.5 })).toBe(5);
  });
});

describe("safeEnvNumber", () => {
  it("reads from process.env", () => {
    process.env.TEST_SAFE_NUM = "42";
    expect(safeEnvNumber("TEST_SAFE_NUM", { fallback: 0 })).toBe(42);
    delete process.env.TEST_SAFE_NUM;
  });

  it("returns fallback for missing env var", () => {
    delete process.env.TEST_SAFE_NUM_MISSING;
    expect(safeEnvNumber("TEST_SAFE_NUM_MISSING", { fallback: 99 })).toBe(99);
  });
});

describe("safeEnvInt", () => {
  it("floors env value", () => {
    process.env.TEST_SAFE_INT = "7.8";
    expect(safeEnvInt("TEST_SAFE_INT", { fallback: 0 })).toBe(7);
    delete process.env.TEST_SAFE_INT;
  });
});
