import { harvestProductSignals } from "@/lib/product-enrichment/signal-harvester";
import { CATEGORY_VALUES, SUBCATEGORY_BY_CATEGORY } from "@/lib/product-enrichment/constants";

type Case = {
  name: string;
  description?: string | null;
  seoTags?: string[];
  currentCategory?: string | null;
  currentSubcategory?: string | null;
  currentGender?: string | null;
  expect: {
    inferredCategory?: string;
    inferredSubcategory?: string | null;
    inferredGender?: string | null;
    notInferredGender?: string;
    nameCategory?: string | null;
    nameSubcategory?: string | null;
    notNameSubcategory?: string;
  };
};

const CASES: Case[] = [
  {
    name: "Jorts Courage Sogno-Camel",
    expect: {
      inferredCategory: "shorts_y_bermudas",
      inferredSubcategory: "short_denim",
      nameSubcategory: "short_denim",
    },
  },
  {
    name: "GLIDERS",
    expect: {
      inferredCategory: "calzado",
      inferredSubcategory: "tenis_sneakers",
      nameSubcategory: "tenis_sneakers",
    },
  },
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
    name: "Portalapicero Ejecutivo Love Letters",
    expect: {
      inferredCategory: "bolsos_y_marroquineria",
      inferredSubcategory: "estuches_cartucheras_neceseres",
      nameSubcategory: "estuches_cartucheras_neceseres",
    },
  },
  {
    name: "Botilito Plegable Origami 650 ml Rojo",
    expect: {
      inferredCategory: "hogar_y_lifestyle",
      inferredSubcategory: "cocina_y_vajilla",
      nameSubcategory: "cocina_y_vajilla",
    },
  },
  {
    name: "Juguete Bone para mascota",
    expect: {
      inferredCategory: "hogar_y_lifestyle",
      inferredSubcategory: "hogar_otros",
      nameSubcategory: "hogar_otros",
    },
  },
  {
    name: "Llavero de Peluche Heart color Gris",
    expect: {
      inferredCategory: "joyeria_y_bisuteria",
      inferredSubcategory: "dijes_charms",
      nameSubcategory: "dijes_charms",
    },
  },
  {
    name: "Producto de cuero REF GRASA-FINA-PARA-CUERO",
    expect: {
      inferredCategory: "hogar_y_lifestyle",
      inferredSubcategory: "hogar_otros",
      nameSubcategory: "hogar_otros",
    },
  },
  {
    name: "Hoodie Azul Bebe con cremallera",
    currentGender: "femenino",
    expect: {
      notInferredGender: "infantil",
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
        description: testCase.description ?? null,
        metadata: null,
        sourceUrl: null,
        seoTitle: null,
        seoDescription: null,
        seoTags: testCase.seoTags ?? [],
        currentCategory: testCase.currentCategory ?? null,
        currentGender: testCase.currentGender ?? null,
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
      if (testCase.expect.inferredGender !== undefined) {
        assertEqual(`${testCase.name}: inferredGender`, signals.inferredGender, testCase.expect.inferredGender);
      }
      if (testCase.expect.notInferredGender) {
        assertNotEqual(
          `${testCase.name}: inferredGender`,
          signals.inferredGender,
          testCase.expect.notInferredGender,
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
