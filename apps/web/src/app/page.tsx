import { Suspense } from "react";
import Header from "@/components/Header";
import OdaFooter from "@/components/OdaFooter";
import HomeBelowFold from "@/components/home/HomeBelowFold";
import HomeHeroImmersive from "@/components/home/HomeHeroImmersive";
import StyleNavigator from "@/components/home/StyleNavigator";
import { getHeroSlides, getHomeConfig, getMegaMenuData, getRotationSeed } from "@/lib/home-data";
import { REAL_STYLE_OPTIONS } from "@/lib/real-style/constants";

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

      <StyleNavigator styles={REAL_STYLE_OPTIONS} />

      <Suspense
        fallback={
          <div className="oda-container py-14 sm:py-18">
            <div className="h-8 w-52 animate-pulse rounded-full bg-white" />
            <div className="mt-4 h-[58svh] animate-pulse rounded-[1.2rem] bg-white" />
          </div>
        }
      >
        <HomeBelowFold seed={seed} heroIds={heroSlides.map((slide) => slide.id)} config={homeConfig} />
      </Suspense>

      <OdaFooter />
    </main>
  );
}
