import { Suspense } from "react";
import Header from "@/components/Header";
import OdaFooter from "@/components/OdaFooter";
import HomeBelowFold from "@/components/home/HomeBelowFold";
import HomeHeroImmersive from "@/components/home/HomeHeroImmersive";
import { getHeroSlides, getHomeConfig, getMegaMenuData, getRotationSeed } from "@/lib/home-data";

export const revalidate = 3600;

export default async function Home() {
  const seed = getRotationSeed();
  const [menu, heroSlides, homeConfig] = await Promise.all([
    getMegaMenuData(),
    getHeroSlides(seed, 4),
    getHomeConfig(),
  ]);

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />

      <HomeHeroImmersive slides={heroSlides} config={homeConfig} />

      <Suspense
        fallback={
          <>
            {/* Style nav skeleton */}
            <div className="border-b border-[color:var(--oda-border)] bg-white/80">
              <div className="oda-container flex gap-3 py-4">
                <div className="h-6 w-16 animate-pulse rounded-full bg-[color:var(--oda-stone)]" />
                <div className="h-10 w-36 animate-pulse rounded-full bg-[color:var(--oda-stone)]" />
                <div className="h-10 w-40 animate-pulse rounded-full bg-[color:var(--oda-stone)]" />
                <div className="hidden h-10 w-32 animate-pulse rounded-full bg-[color:var(--oda-stone)] sm:block" />
              </div>
            </div>
            {/* Real Style showcase skeleton */}
            <div className="bg-[color:var(--oda-ink)]">
              <div className="oda-container py-14 sm:py-18">
                <div className="h-6 w-20 animate-pulse rounded-full bg-white/10" />
                <div className="mt-3 h-12 w-80 animate-pulse rounded-full bg-white/10" />
                <div className="mt-8 h-[52svh] animate-pulse rounded-[1.6rem] bg-white/5" />
              </div>
            </div>
          </>
        }
      >
        <HomeBelowFold seed={seed} heroIds={heroSlides.map((slide) => slide.id)} config={homeConfig} />
      </Suspense>

      <OdaFooter />
    </main>
  );
}
