import { Suspense } from "react";
import PdpBreadcrumbs from "@/components/pdp/PdpBreadcrumbs";
import PdpInteractiveSection from "@/components/pdp/PdpInteractiveSection";
import PdpAccordionSection from "@/components/pdp/PdpAccordionSection";
import PdpBrandSection from "@/components/pdp/PdpBrandSection";
import PdpRelatedProducts from "@/components/pdp/PdpRelatedProducts";
import type { PdpProduct, PdpRelatedProduct } from "@/lib/pdp-data";

type Props = {
  product: PdpProduct;
  relatedProducts: PdpRelatedProduct[];
};

function buildMaterialsText(product: PdpProduct): string | null {
  const parts: string[] = [];
  if (product.materialTags.length > 0) {
    parts.push(product.materialTags.join(", "));
  }
  if (product.patternTags.length > 0) {
    parts.push(`Patrón: ${product.patternTags.join(", ")}`);
  }
  // Collect unique fit values from variants
  const fits = new Set(
    product.variants.map((v) => v.fit).filter(Boolean) as string[],
  );
  if (fits.size > 0) {
    parts.push(`Ajuste: ${Array.from(fits).join(", ")}`);
  }
  // Collect unique material values from variants
  const materials = new Set(
    product.variants.map((v) => v.material).filter(Boolean) as string[],
  );
  if (materials.size > 0 && product.materialTags.length === 0) {
    parts.push(Array.from(materials).join(", "));
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function buildSeasonOccasionText(product: PdpProduct): string | null {
  const parts: string[] = [];
  if (product.season) parts.push(`Temporada: ${product.season}`);
  if (product.occasionTags.length > 0) {
    parts.push(`Ocasión: ${product.occasionTags.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

export default function PdpLayout({ product, relatedProducts }: Props) {
  const materialsText = buildMaterialsText(product);
  const seasonOccasionText = buildSeasonOccasionText(product);

  const accordions = (
    <>
      <PdpAccordionSection
        title="Descripción"
        content={product.description}
      />
      <PdpAccordionSection title="Materiales" content={materialsText} />
      <PdpAccordionSection title="Cuidado" content={product.care} />
      <PdpAccordionSection
        title="Temporada y Ocasión"
        content={seasonOccasionText}
      />
    </>
  );

  return (
    <div className="bg-[color:var(--oda-cream)]">
      <div className="oda-container">
        <PdpBreadcrumbs
          gender={product.gender}
          category={product.category}
          subcategory={product.subcategory}
          productName={product.name}
        />

        {/* Main content: gallery + product info (accordions in sidebar on desktop) */}
        <PdpInteractiveSection
          product={product}
          accordionContent={accordions}
        />

        {/* Accordion details — mobile only (desktop shows in sidebar) */}
        <div className="mt-8 lg:hidden">
          {accordions}
        </div>

        {/* Brand section */}
        <PdpBrandSection brand={product.brand} />

        {/* Related products */}
        {relatedProducts.length > 0 && (
          <Suspense>
            <PdpRelatedProducts products={relatedProducts} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
