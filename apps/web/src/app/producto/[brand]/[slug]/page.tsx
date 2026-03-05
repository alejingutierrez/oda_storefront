import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import PdpLayout from "@/components/pdp/PdpLayout";
import { getProductByBrandAndSlug, getRelatedProducts } from "@/lib/pdp-data";
import { getMegaMenuData } from "@/lib/home-data";

export const revalidate = 120;

type Params = { brand: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Params | Promise<Params>;
}): Promise<Metadata> {
  const { brand, slug } = await params;
  const product = await getProductByBrandAndSlug(brand, slug);
  if (!product) return {};

  const title =
    product.seoTitle ||
    `${product.name} – ${product.brand.name} | ODA`;
  const description =
    product.seoDescription ||
    product.description?.slice(0, 160) ||
    `${product.name} de ${product.brand.name}. Descubre moda colombiana en ODA.`;
  const canonical = `/producto/${product.brand.slug}/${product.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: product.imageCoverUrl ? [{ url: product.imageCoverUrl }] : [],
    },
  };
}

function buildJsonLd(product: NonNullable<Awaited<ReturnType<typeof getProductByBrandAndSlug>>>) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    image: product.colorGroups[0]?.images ?? (product.imageCoverUrl ? [product.imageCoverUrl] : []),
    brand: { "@type": "Brand", name: product.brand.name },
    offers: {
      "@type": "AggregateOffer",
      lowPrice: product.minPriceCop ?? undefined,
      highPrice: product.maxPriceCop ?? undefined,
      priceCurrency: product.currency ?? "COP",
      availability: product.hasInStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: product.sourceUrl ?? undefined,
    },
  };
}

export default async function PdpPage({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  const { brand, slug } = await params;
  const [product, menu] = await Promise.all([
    getProductByBrandAndSlug(brand, slug),
    getMegaMenuData(),
  ]);
  if (!product) notFound();

  const relatedProducts = await getRelatedProducts(product.id, {
    brandId: product.brand.id,
    category: product.category,
    gender: product.gender,
    realStyle: product.realStyle,
    limit: 12,
  });

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(product)) }}
      />
      <PdpLayout product={product} relatedProducts={relatedProducts} />
    </main>
  );
}
