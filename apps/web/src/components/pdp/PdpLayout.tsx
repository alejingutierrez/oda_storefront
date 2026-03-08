import { Suspense } from "react";
import PdpBreadcrumbs from "@/components/pdp/PdpBreadcrumbs";
import PdpInteractiveSection from "@/components/pdp/PdpInteractiveSection";
import PdpAccordionSection from "@/components/pdp/PdpAccordionSection";
import PdpSpecsTable from "@/components/pdp/PdpSpecsTable";
import PdpBrandSection from "@/components/pdp/PdpBrandSection";
import PdpRelatedProducts from "@/components/pdp/PdpRelatedProducts";
import PdpOutfitSuggestion from "@/components/pdp/PdpOutfitSuggestion";
import type { PdpProduct, PdpRelatedProduct, PdpPriceInsight, PdpPriceHistory, PdpOutfitItem } from "@/lib/pdp-data";

type Props = {
  product: PdpProduct;
  relatedProducts: PdpRelatedProduct[];
  priceInsight: PdpPriceInsight;
  priceHistory: PdpPriceHistory;
  outfitItems: PdpOutfitItem[];
};

export default function PdpLayout({ product, relatedProducts, priceInsight, priceHistory, outfitItems }: Props) {
  const specsContent = <PdpSpecsTable product={product} />;

  const accordions = (
    <PdpAccordionSection
      title="Especificaciones"
      content={specsContent}
      defaultOpen
    />
  );

  return (
    <div className="bg-[color:var(--oda-cream)]">
      <div className="oda-container pb-24 lg:pb-0">
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
          priceInsight={priceInsight}
          priceHistory={priceHistory}
        />

        {/* Accordion details — mobile only (desktop shows in sidebar) */}
        <div className="mt-8 lg:hidden">
          {accordions}
        </div>

        {/* Outfit suggestion */}
        {outfitItems.length > 0 && (
          <PdpOutfitSuggestion items={outfitItems} />
        )}

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
