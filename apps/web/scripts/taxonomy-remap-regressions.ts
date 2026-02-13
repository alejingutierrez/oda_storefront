import { harvestProductSignals } from "@/lib/product-enrichment/signal-harvester";
import { CATEGORY_VALUES, SUBCATEGORY_BY_CATEGORY } from "@/lib/product-enrichment/constants";

type Case = {
  name: string;
  currentCategory?: string | null;
  currentSubcategory?: string | null;
  expect: {
    inferredCategory?: string;
    inferredSubcategory?: string | null;
    nameCategory?: string | null;
    nameSubcategory?: string | null;
    notNameSubcategory?: string;
  };
};

const CASES: Case[] = [
  {
    name: "Collar Curva Plata",
    currentCategory: "joyeria_y_bisuteria",
    currentSubcategory: "collares",
    expect: {
      inferredCategory: "joyeria_y_bisuteria",
      inferredSubcategory: "collares",
      nameSubcategory: "collares",
    },
  },
  {
    name: "Charm Handmade (x1) — for Clarte Choker",
    currentCategory: "joyeria_y_bisuteria",
    currentSubcategory: "dijes_charms",
    expect: {
      inferredCategory: "joyeria_y_bisuteria",
      inferredSubcategory: "dijes_charms",
      nameSubcategory: "dijes_charms",
    },
  },
  {
    name: "Pulsera Danza",
    currentCategory: "joyeria_y_bisuteria",
    currentSubcategory: "pulseras_brazaletes",
    expect: {
      inferredCategory: "joyeria_y_bisuteria",
      inferredSubcategory: "pulseras_brazaletes",
      nameSubcategory: "pulseras_brazaletes",
    },
  },
  {
    name: "Zalva Bangle (Set x3 Bangles)",
    currentCategory: "joyeria_y_bisuteria",
    currentSubcategory: "pulseras_brazaletes",
    expect: {
      inferredCategory: "joyeria_y_bisuteria",
      inferredSubcategory: "pulseras_brazaletes",
      nameSubcategory: "pulseras_brazaletes",
    },
  },
  {
    name: "Active Zip-Up Jacket - Black",
    expect: {
      nameCategory: "chaquetas_y_abrigos",
      notNameSubcategory: "chaqueta_denim",
    },
  },
];

const assertEqual = (label: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
};

const assertNotEqual = (label: string, actual: unknown, notExpected: unknown) => {
  if (actual === notExpected) {
    throw new Error(`${label} expected != ${JSON.stringify(notExpected)} but got ${JSON.stringify(actual)}`);
  }
};

const run = () => {
  const failures: string[] = [];
  CASES.forEach((testCase) => {
    try {
      const signals = harvestProductSignals({
        name: testCase.name,
        description: null,
        metadata: null,
        sourceUrl: null,
        seoTitle: null,
        seoDescription: null,
        seoTags: [],
        currentCategory: testCase.currentCategory ?? null,
        currentGender: null,
        allowedCategoryValues: CATEGORY_VALUES,
        subcategoryByCategory: SUBCATEGORY_BY_CATEGORY,
      });

      if (testCase.expect.inferredCategory !== undefined) {
        assertEqual(`${testCase.name}: inferredCategory`, signals.inferredCategory, testCase.expect.inferredCategory);
      }
      if (testCase.expect.inferredSubcategory !== undefined) {
        assertEqual(
          `${testCase.name}: inferredSubcategory`,
          signals.inferredSubcategory,
          testCase.expect.inferredSubcategory,
        );
      }
      if (testCase.expect.nameCategory !== undefined) {
        assertEqual(`${testCase.name}: nameCategory`, signals.nameCategory, testCase.expect.nameCategory);
      }
      if (testCase.expect.nameSubcategory !== undefined) {
        assertEqual(`${testCase.name}: nameSubcategory`, signals.nameSubcategory, testCase.expect.nameSubcategory);
      }
      if (testCase.expect.notNameSubcategory) {
        assertNotEqual(
          `${testCase.name}: nameSubcategory`,
          signals.nameSubcategory,
          testCase.expect.notNameSubcategory,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
    }
  });

  if (failures.length) {
    console.error(`taxonomy-remap regressions failed (${failures.length}):`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(`taxonomy-remap regressions passed (${CASES.length} cases).`);
};

run();

