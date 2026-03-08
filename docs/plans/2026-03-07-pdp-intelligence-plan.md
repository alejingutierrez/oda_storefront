# PDP Intelligence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 8 intelligence features to the PDP to transform it into a retention-focused discovery hub.

**Architecture:** Server-side data enrichment in `pdp-data.ts` feeds new props to existing PDP components. New client components are lightweight and reuse ODA design tokens. Price analysis queries use the existing `PriceHistory` table. Outfit suggestions use range-scan on `random_sort_key` with rotation seed. Auth-dependent features (price alerts, lists) follow the `requireUser()` pattern from favorites.

**Tech Stack:** Next.js 16 App Router, Prisma 7, React 19, Tailwind CSS 4, Lucide icons, ioredis

---

## Phase 1 — Quick Wins

### Task 1: Best Price Badge — Data Layer

**Files:**
- Modify: `apps/web/src/lib/pdp-data.ts`

**Step 1: Add price analysis types to pdp-data.ts**

Add these types after the existing `PdpRelatedProduct` type (~line 97):

```typescript
export type PdpPriceInsight = {
  isBestPrice30d: boolean;
  isDeepDiscount: boolean; // >= 30% off max in 30 days
  min30d: number | null;
  max30d: number | null;
};
```

**Step 2: Add getPriceInsight query**

Add this function after `getRelatedProducts`:

```typescript
export async function getPriceInsight(
  productId: string,
  currentMinPrice: string | null,
): Promise<PdpPriceInsight> {
  if (!currentMinPrice || Number(currentMinPrice) <= 0) {
    return { isBestPrice30d: false, isDeepDiscount: false, min30d: null, max30d: null };
  }

  const cached = unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await prisma.priceHistory.aggregate({
        where: {
          variant: { productId },
          capturedAt: { gte: thirtyDaysAgo },
        },
        _min: { price: true },
        _max: { price: true },
      });

      const min30d = result._min.price ? Number(result._min.price) : null;
      const max30d = result._max.price ? Number(result._max.price) : null;
      const current = Number(currentMinPrice);

      const isBestPrice30d = min30d !== null && current <= min30d;
      const isDeepDiscount =
        max30d !== null && max30d > 0 && (max30d - current) / max30d >= 0.3;

      return { isBestPrice30d, isDeepDiscount, min30d, max30d };
    },
    [`pdp-price-insight-v1`, productId],
    { revalidate: PDP_REVALIDATE_SECONDS * 2, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}
```

**Step 3: Commit**
```bash
git add apps/web/src/lib/pdp-data.ts
git commit -m "feat(pdp): add price insight query for best-price badge"
```

---

### Task 2: Best Price Badge — UI Component

**Files:**
- Create: `apps/web/src/components/pdp/PdpPriceBadge.tsx`

**Step 1: Create the badge component**

```typescript
import type { PdpPriceInsight } from "@/lib/pdp-data";

type Props = {
  insight: PdpPriceInsight;
};

export default function PdpPriceBadge({ insight }: Props) {
  if (insight.isBestPrice30d) {
    return (
      <span className="inline-flex items-center rounded-full bg-[color:var(--oda-gold)]/20 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--oda-ink)]">
        Mejor precio
      </span>
    );
  }

  if (insight.isDeepDiscount) {
    return (
      <span className="inline-flex items-center rounded-full bg-[color:var(--oda-gold)]/20 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--oda-ink)]">
        Gran descuento
      </span>
    );
  }

  return null;
}
```

**Step 2: Commit**
```bash
git add apps/web/src/components/pdp/PdpPriceBadge.tsx
git commit -m "feat(pdp): add PdpPriceBadge component"
```

---

### Task 3: Best Price Badge — Wire into PDP page

**Files:**
- Modify: `apps/web/src/app/producto/[brand]/[slug]/page.tsx`
- Modify: `apps/web/src/components/pdp/PdpLayout.tsx`
- Modify: `apps/web/src/components/pdp/PdpInteractiveSection.tsx`

**Step 1: Fetch price insight in the page**

In `page.tsx`, import `getPriceInsight` and call it in parallel alongside `getRelatedProducts`:

```typescript
import { getProductByBrandAndSlug, getRelatedProducts, getPriceInsight } from "@/lib/pdp-data";
```

Replace the sequential `getRelatedProducts` call (~line 62-67) with:

```typescript
  const [relatedProducts, priceInsight] = await Promise.all([
    getRelatedProducts(product.id, {
      brandId: product.brand.id,
      category: product.category,
      gender: product.gender,
      realStyle: product.realStyle,
      limit: 12,
    }),
    getPriceInsight(product.id, product.minPriceCop),
  ]);
```

Pass `priceInsight` to `PdpLayout`:

```typescript
<PdpLayout product={product} relatedProducts={relatedProducts} priceInsight={priceInsight} />
```

**Step 2: Thread priceInsight through PdpLayout to PdpInteractiveSection**

In `PdpLayout.tsx`, add `priceInsight` to Props type and pass it to `PdpInteractiveSection`:

```typescript
import type { PdpProduct, PdpRelatedProduct, PdpPriceInsight } from "@/lib/pdp-data";

type Props = {
  product: PdpProduct;
  relatedProducts: PdpRelatedProduct[];
  priceInsight: PdpPriceInsight;
};
```

Pass to interactive section:
```typescript
<PdpInteractiveSection product={product} accordionContent={accordions} priceInsight={priceInsight} />
```

**Step 3: Render PdpPriceBadge in PdpInteractiveSection**

In `PdpInteractiveSection.tsx`, add to imports:
```typescript
import PdpPriceBadge from "@/components/pdp/PdpPriceBadge";
import type { PdpProduct, PdpPriceInsight } from "@/lib/pdp-data";
```

Add `priceInsight` to Props:
```typescript
type Props = {
  product: PdpProduct;
  accordionContent?: ReactNode;
  priceInsight: PdpPriceInsight;
};
```

Add destructuring in the function signature and render badge right after `PdpPriceDisplay`:

```typescript
{/* Price */}
<div className="mt-3">
  <PdpPriceDisplay
    price={displayPrice}
    currency={displayCurrency}
    hasRange={!!hasRange}
    priceChangeDirection={product.priceChangeDirection}
  />
  <div className="mt-1.5">
    <PdpPriceBadge insight={priceInsight} />
  </div>
</div>
```

**Step 4: Verify the PDP renders correctly**

Run: `npm run dev` (in apps/web), navigate to a product page, confirm badge shows when applicable.

**Step 5: Commit**
```bash
git add apps/web/src/app/producto/[brand]/[slug]/page.tsx apps/web/src/components/pdp/PdpLayout.tsx apps/web/src/components/pdp/PdpInteractiveSection.tsx
git commit -m "feat(pdp): wire price insight badge into PDP"
```

---

### Task 4: Occasion Pills — Component

**Files:**
- Create: `apps/web/src/components/pdp/PdpOccasionPills.tsx`

**Step 1: Create the occasion pills component**

```typescript
import Link from "next/link";
import { normalizeGender, GENDER_ROUTE } from "@/lib/navigation";

type Props = {
  occasionTags: string[];
  gender: string | null;
};

export default function PdpOccasionPills({ occasionTags, gender }: Props) {
  if (occasionTags.length === 0) return null;

  const genderKey = normalizeGender(gender);
  const genderRoute = GENDER_ROUTE[genderKey];
  const pills = occasionTags.slice(0, 5);

  return (
    <div className="flex gap-2 overflow-x-auto oda-no-scrollbar">
      {pills.map((tag) => (
        <Link
          key={tag}
          href={`/${genderRoute}?occasion=${encodeURIComponent(tag)}`}
          prefetch={false}
          className="shrink-0 rounded-full border border-[color:var(--oda-border)] px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-[color:var(--oda-ink-soft)] transition hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]"
        >
          {tag}
        </Link>
      ))}
    </div>
  );
}
```

**Step 2: Commit**
```bash
git add apps/web/src/components/pdp/PdpOccasionPills.tsx
git commit -m "feat(pdp): add PdpOccasionPills component"
```

---

### Task 5: Occasion Pills — Wire into PDP

**Files:**
- Modify: `apps/web/src/components/pdp/PdpInteractiveSection.tsx`

**Step 1: Import and render pills**

Add import:
```typescript
import PdpOccasionPills from "@/components/pdp/PdpOccasionPills";
```

Render after the description paragraph and before the availability badge (~after line with `displayDescription`):

```typescript
{/* Occasion pills */}
{product.occasionTags.length > 0 && (
  <div className="mt-3">
    <PdpOccasionPills
      occasionTags={product.occasionTags}
      gender={product.gender}
    />
  </div>
)}
```

**Step 2: Verify — navigate to a product with occasionTags, confirm pills render and link correctly**

**Step 3: Commit**
```bash
git add apps/web/src/components/pdp/PdpInteractiveSection.tsx
git commit -m "feat(pdp): wire occasion pills into PDP sidebar"
```

---

### Task 6: Distinction Badges — Component

**Files:**
- Create: `apps/web/src/components/pdp/PdpDistinctionBadges.tsx`

**Step 1: Create the badges component**

The Product model has `realStyle` (string, one of 8 curated styles), `editorialTopPickRank` (non-null int = is a top pick), and `editorialFavoriteRank` (non-null int = is editor favorite).

```typescript
import { Star, Award, Heart } from "lucide-react";

type Props = {
  realStyle: string | null;
  editorialTopPickRank: number | null;
  editorialFavoriteRank: number | null;
};

export default function PdpDistinctionBadges({
  realStyle,
  editorialTopPickRank,
  editorialFavoriteRank,
}: Props) {
  const badges: { icon: typeof Star; label: string; className: string }[] = [];

  if (realStyle) {
    badges.push({
      icon: Star,
      label: realStyle,
      className: "border-[color:var(--oda-gold)] text-[color:var(--oda-ink)]",
    });
  }

  if (editorialTopPickRank != null) {
    badges.push({
      icon: Award,
      label: "Top Pick",
      className: "border-[color:var(--oda-gold)] text-[color:var(--oda-ink)]",
    });
  }

  if (editorialFavoriteRank != null) {
    badges.push({
      icon: Heart,
      label: "Editor Favorite",
      className: "border-[color:var(--oda-gold)] text-[color:var(--oda-ink)]",
    });
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => {
        const Icon = badge.icon;
        return (
          <span
            key={badge.label}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] ${badge.className}`}
          >
            <Icon className="h-3 w-3" />
            {badge.label}
          </span>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**
```bash
git add apps/web/src/components/pdp/PdpDistinctionBadges.tsx
git commit -m "feat(pdp): add PdpDistinctionBadges component"
```

---

### Task 7: Distinction Badges — Data + Wiring

**Files:**
- Modify: `apps/web/src/lib/pdp-data.ts`
- Modify: `apps/web/src/components/pdp/PdpInteractiveSection.tsx`

**Step 1: Add editorial fields to PdpProduct type and query**

In `pdp-data.ts`, add to `PdpProduct` type (~line 60):
```typescript
  editorialTopPickRank: number | null;
  editorialFavoriteRank: number | null;
  origin: string | null;
```

In the `getProductByBrandAndSlug` function, the `Product.findFirst` already returns all columns. Add these fields to the return object (~line 160):
```typescript
        editorialTopPickRank: product.editorialTopPickRank,
        editorialFavoriteRank: product.editorialFavoriteRank,
        origin: product.origin,
```

**Step 2: Render badges in PdpInteractiveSection**

Add import:
```typescript
import PdpDistinctionBadges from "@/components/pdp/PdpDistinctionBadges";
```

Render ABOVE the brand name link (before the `<Link>` to `/marca/...`):

```typescript
{/* Distinction badges */}
<PdpDistinctionBadges
  realStyle={product.realStyle}
  editorialTopPickRank={product.editorialTopPickRank}
  editorialFavoriteRank={product.editorialFavoriteRank}
/>
```

**Step 3: Verify — check a product that has `realStyle` set, confirm badges render**

**Step 4: Commit**
```bash
git add apps/web/src/lib/pdp-data.ts apps/web/src/components/pdp/PdpInteractiveSection.tsx
git commit -m "feat(pdp): wire distinction badges with editorial fields"
```

---

### Task 8: Enhanced Materials in Specs — Add origin

**Files:**
- Modify: `apps/web/src/components/pdp/PdpSpecsTable.tsx`

**Step 1: Add origin row to PdpSpecsTable**

Import `MapPin` from lucide-react. Add an origin row after the materials row:

```typescript
import { Palette, Layers, Scaling, Sun, Calendar, Sparkles, MapPin } from "lucide-react";
```

After the materialTags block (~line 24), add:

```typescript
  // Origin
  if (product.origin) {
    rows.push({
      icon: MapPin,
      label: "Origen",
      value: product.origin,
    });
  }
```

Note: `product.origin` needs to be available. Since we added `origin` to `PdpProduct` type in Task 7, this is already available.

**Step 2: Verify — check a product with origin data, confirm it renders**

**Step 3: Commit**
```bash
git add apps/web/src/components/pdp/PdpSpecsTable.tsx
git commit -m "feat(pdp): add product origin to specs table"
```

---

**Phase 1 checkpoint: Verify all 3 quick wins render correctly on a product page. Run `npm run build` to check for type errors.**

---

## Phase 2 — Medium Complexity

### Task 9: Price History Sparkline — Data Layer

**Files:**
- Modify: `apps/web/src/lib/pdp-data.ts`

**Step 1: Add price history type and query**

Add type:
```typescript
export type PdpPriceHistoryPoint = {
  price: number;
  date: string; // ISO date string (day only)
};

export type PdpPriceHistory = {
  points: PdpPriceHistoryPoint[];
  currentIsAllTimeLow: boolean;
  daysCovered: number;
};
```

Add query function:
```typescript
export async function getPriceHistory(
  productId: string,
  currentMinPrice: string | null,
): Promise<PdpPriceHistory> {
  const empty: PdpPriceHistory = { points: [], currentIsAllTimeLow: false, daysCovered: 0 };
  if (!currentMinPrice || Number(currentMinPrice) <= 0) return empty;

  const cached = unstable_cache(
    async () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      // Get daily min price per product (across all variants)
      const rows: { day: Date; minPrice: unknown }[] = await prisma.$queryRaw`
        SELECT date_trunc('day', ph."capturedAt") AS day,
               MIN(ph.price) AS "minPrice"
        FROM price_history ph
        JOIN variants v ON v.id = ph."variantId"
        WHERE v."productId" = ${productId}
          AND ph."capturedAt" >= ${ninetyDaysAgo}
        GROUP BY day
        ORDER BY day
      `;

      if (rows.length < 7) return empty;

      const points: PdpPriceHistoryPoint[] = rows.map((r) => ({
        price: Number(r.minPrice),
        date: new Date(r.day).toISOString().split("T")[0],
      }));

      const allTimeMin = Math.min(...points.map((p) => p.price));
      const current = Number(currentMinPrice);
      const currentIsAllTimeLow = current <= allTimeMin;

      return {
        points,
        currentIsAllTimeLow,
        daysCovered: points.length,
      };
    },
    [`pdp-price-history-v1`, productId],
    { revalidate: PDP_REVALIDATE_SECONDS * 5, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}
```

**Step 2: Commit**
```bash
git add apps/web/src/lib/pdp-data.ts
git commit -m "feat(pdp): add price history data query (90-day daily min)"
```

---

### Task 10: Price History Sparkline — SVG Component

**Files:**
- Create: `apps/web/src/components/pdp/PdpPriceSparkline.tsx`

**Step 1: Create sparkline component**

This generates a server-rendered inline SVG. No JS needed.

```typescript
import type { PdpPriceHistory } from "@/lib/pdp-data";

type Props = {
  history: PdpPriceHistory;
};

function buildSparklinePath(points: { price: number }[], width: number, height: number): string {
  if (points.length < 2) return "";

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const stepX = width / (points.length - 1);
  const padding = 2; // vertical padding
  const usableHeight = height - padding * 2;

  return points
    .map((p, i) => {
      const x = i * stepX;
      const y = padding + usableHeight - ((p.price - min) / range) * usableHeight;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function PdpPriceSparkline({ history }: Props) {
  if (history.points.length < 7) return null;

  const width = 60;
  const height = 16;
  const path = buildSparklinePath(history.points, width, height);

  return (
    <div className="flex items-center gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0"
        aria-hidden
      >
        <path
          d={path}
          fill="none"
          stroke="var(--oda-taupe)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`text-[10px] tracking-[0.08em] ${
          history.currentIsAllTimeLow
            ? "text-[color:var(--oda-gold)] font-medium"
            : "text-[color:var(--oda-taupe)]"
        }`}
      >
        {history.currentIsAllTimeLow
          ? "Precio más bajo registrado"
          : `${history.daysCovered} días de historial`}
      </span>
    </div>
  );
}
```

**Step 2: Commit**
```bash
git add apps/web/src/components/pdp/PdpPriceSparkline.tsx
git commit -m "feat(pdp): add PdpPriceSparkline SVG component"
```

---

### Task 11: Price History Sparkline — Wire into PDP

**Files:**
- Modify: `apps/web/src/app/producto/[brand]/[slug]/page.tsx`
- Modify: `apps/web/src/components/pdp/PdpLayout.tsx`
- Modify: `apps/web/src/components/pdp/PdpInteractiveSection.tsx`

**Step 1: Fetch price history in page.tsx**

Add `getPriceHistory` to the import. Add it to the `Promise.all`:

```typescript
import { getProductByBrandAndSlug, getRelatedProducts, getPriceInsight, getPriceHistory } from "@/lib/pdp-data";
```

```typescript
  const [relatedProducts, priceInsight, priceHistory] = await Promise.all([
    getRelatedProducts(product.id, { ... }),
    getPriceInsight(product.id, product.minPriceCop),
    getPriceHistory(product.id, product.minPriceCop),
  ]);
```

Pass to layout:
```typescript
<PdpLayout product={product} relatedProducts={relatedProducts} priceInsight={priceInsight} priceHistory={priceHistory} />
```

**Step 2: Thread through PdpLayout**

Add `PdpPriceHistory` to imports and Props, pass to `PdpInteractiveSection`:

```typescript
import type { PdpProduct, PdpRelatedProduct, PdpPriceInsight, PdpPriceHistory } from "@/lib/pdp-data";

type Props = {
  product: PdpProduct;
  relatedProducts: PdpRelatedProduct[];
  priceInsight: PdpPriceInsight;
  priceHistory: PdpPriceHistory;
};
```

**Step 3: Render sparkline in PdpInteractiveSection**

Import:
```typescript
import PdpPriceSparkline from "@/components/pdp/PdpPriceSparkline";
import type { PdpProduct, PdpPriceInsight, PdpPriceHistory } from "@/lib/pdp-data";
```

Add `priceHistory: PdpPriceHistory` to Props. Render after PdpPriceBadge:

```typescript
{/* Price sparkline */}
<PdpPriceSparkline history={priceHistory} />
```

**Step 4: Verify — check products with price history, confirm sparkline renders**

**Step 5: Commit**
```bash
git add apps/web/src/app/producto/[brand]/[slug]/page.tsx apps/web/src/components/pdp/PdpLayout.tsx apps/web/src/components/pdp/PdpInteractiveSection.tsx
git commit -m "feat(pdp): wire price history sparkline into PDP"
```

---

### Task 12: Add to List — Popover Component

**Files:**
- Create: `apps/web/src/components/pdp/PdpAddToList.tsx`

**Step 1: Create the add-to-list popover**

This is a client component that fetches user lists and allows adding the product.

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bookmark, Check, Plus, X } from "lucide-react";
import { useSession } from "@descope/nextjs-sdk/client";

type UserList = {
  id: string;
  name: string;
  _count: { items: number };
  hasProduct: boolean;
};

type Props = {
  productId: string;
  className?: string;
};

export default function PdpAddToList({ productId, className }: Props) {
  const { isAuthenticated } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [lists, setLists] = useState<UserList[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Fetch lists when opening
  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/user/lists?productId=${productId}`);
      if (res.ok) {
        const data = await res.json();
        setLists(data.lists ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [productId]);

  const handleOpen = useCallback(() => {
    if (!isAuthenticated) {
      window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setIsOpen(true);
    fetchLists();
  }, [isAuthenticated, fetchLists]);

  const handleToggleItem = useCallback(async (listId: string, hasProduct: boolean) => {
    if (hasProduct) {
      await fetch(`/api/user/lists/${listId}/items?productId=${productId}`, { method: "DELETE" });
    } else {
      await fetch(`/api/user/lists/${listId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
    }
    fetchLists();
  }, [productId, fetchLists]);

  const handleCreateList = useCallback(async () => {
    if (!newListName.trim()) return;
    await fetch("/api/user/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newListName.trim() }),
    });
    setNewListName("");
    setCreating(false);
    fetchLists();
  }, [newListName, fetchLists]);

  const hasAny = lists.some((l) => l.hasProduct);

  return (
    <div ref={popoverRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleOpen}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
          hasAny
            ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
            : "border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] hover:border-[color:var(--oda-ink)] hover:text-[color:var(--oda-ink)]"
        }`}
        aria-label="Guardar en lista"
        title="Guardar en lista"
      >
        <Bookmark className="h-4 w-4" fill={hasAny ? "currentColor" : "none"} />
      </button>

      {isOpen && (
        <div className="absolute right-0 bottom-full mb-2 z-50 w-56 rounded-xl border border-[color:var(--oda-border)] bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-[color:var(--oda-border)] px-3 py-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
              Guardar en lista
            </span>
            <button type="button" onClick={() => { setIsOpen(false); setCreating(false); }} className="text-[color:var(--oda-taupe)] hover:text-[color:var(--oda-ink)]" aria-label="Cerrar">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto p-1.5">
            {loading ? (
              <p className="px-2.5 py-2 text-xs text-[color:var(--oda-taupe)]">Cargando...</p>
            ) : lists.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-[color:var(--oda-taupe)]">No tienes listas aún</p>
            ) : (
              lists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => handleToggleItem(list.id, list.hasProduct)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
                >
                  {list.hasProduct ? (
                    <Check className="h-4 w-4 shrink-0 text-[color:var(--oda-gold)]" />
                  ) : (
                    <span className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{list.name}</span>
                  <span className="ml-auto text-[10px] text-[color:var(--oda-taupe)]">
                    {list._count.items}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-[color:var(--oda-border)] p-1.5">
            {creating ? (
              <div className="flex items-center gap-2 px-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateList()}
                  placeholder="Nombre de la lista"
                  className="flex-1 border-b border-[color:var(--oda-border)] bg-transparent py-1 text-sm text-[color:var(--oda-ink)] outline-none placeholder:text-[color:var(--oda-taupe)]"
                  autoFocus
                />
                <button type="button" onClick={handleCreateList} className="text-[color:var(--oda-ink)] hover:text-[color:var(--oda-gold)]">
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[color:var(--oda-taupe)] transition hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]"
              >
                <Plus className="h-4 w-4" />
                Crear nueva lista
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**
```bash
git add apps/web/src/components/pdp/PdpAddToList.tsx
git commit -m "feat(pdp): add PdpAddToList popover component"
```

---

### Task 13: Add to List — API enhancement + Wire into PDP

**Files:**
- Modify: `apps/web/src/app/api/user/lists/route.ts` — add `productId` query param for `hasProduct`
- Modify: `apps/web/src/components/pdp/PdpInteractiveSection.tsx`

**Step 1: Enhance GET /api/user/lists to accept productId query param**

In the GET handler, after fetching lists, if `productId` is present in the URL search params, check each list for membership:

```typescript
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");

  // ... existing fetch of lists ...

  // If productId provided, check membership per list
  if (productId) {
    const itemCheck = await prisma.userListItem.findMany({
      where: {
        productId,
        listId: { in: lists.map((l) => l.id) },
      },
      select: { listId: true },
    });
    const hasSet = new Set(itemCheck.map((i) => i.listId));
    const enriched = lists.map((l) => ({ ...l, hasProduct: hasSet.has(l.id) }));
    return NextResponse.json({ lists: enriched });
  }
```

**Step 2: Wire PdpAddToList into PdpInteractiveSection**

Import:
```typescript
import PdpAddToList from "@/components/pdp/PdpAddToList";
```

Add after `PdpShareMenu` in the CTA row:
```typescript
<PdpAddToList productId={product.id} className="shrink-0" />
```

**Step 3: Verify — open a PDP, click the bookmark icon, confirm popover opens with lists**

**Step 4: Commit**
```bash
git add apps/web/src/app/api/user/lists/route.ts apps/web/src/components/pdp/PdpInteractiveSection.tsx
git commit -m "feat(pdp): wire add-to-list popover into PDP"
```

---

### Task 14: Lateral Navigation — Context Storage

**Files:**
- Create: `apps/web/src/lib/pdp-nav-context.ts`

**Step 1: Create utility for storing/reading PDP navigation context**

```typescript
const STORAGE_KEY = "oda_pdp_nav_v1";

export type PdpNavContext = {
  productIds: string[];
  currentIndex: number;
  label: string; // e.g. "Camisas — Masculino"
};

export function savePdpNavContext(ctx: PdpNavContext): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
}

export function readPdpNavContext(currentProductId: string): PdpNavContext | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ctx: PdpNavContext = JSON.parse(raw);
    // Update currentIndex to match the product we're viewing
    const idx = ctx.productIds.indexOf(currentProductId);
    if (idx === -1) return null; // Product not in context
    return { ...ctx, currentIndex: idx };
  } catch {
    return null;
  }
}

export function clearPdpNavContext(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
```

**Step 2: Commit**
```bash
git add apps/web/src/lib/pdp-nav-context.ts
git commit -m "feat(pdp): add pdp nav context sessionStorage utility"
```

---

### Task 15: Lateral Navigation — Store context from catalog

**Files:**
- Modify: `apps/web/src/components/CatalogProductCard.tsx`

**Step 1: Save navigation context when user clicks a product card**

Import `savePdpNavContext` in `CatalogProductCard.tsx`. In the click handler (or the Link's onClick), save the current page's product IDs and the clicked index.

This requires access to the list of product IDs on the current page. The simplest approach: add an `onNavigate` prop that `CatalogProductsInfinite` passes with the full product list context.

Alternative simpler approach: In `CatalogProductsInfinite`, wrap product links and save context. But the easiest way is to add it to the card's click handler:

Add prop to `CatalogProductCard`:
```typescript
navContext?: { productIds: string[]; index: number; label: string };
```

In the `<Link>` onClick:
```typescript
onClick={() => {
  if (navContext) {
    savePdpNavContext({
      productIds: navContext.productIds,
      currentIndex: navContext.index,
      label: navContext.label,
    });
  }
  // ... existing tracking code ...
}}
```

**Step 2: Pass navContext from CatalogProductsInfinite**

In `CatalogProductsInfinite.tsx`, compute the product IDs from the current loaded products and pass to each card:

```typescript
const allProductIds = products.map((p) => p.id);
// ... in the map:
<CatalogProductCard
  navContext={{ productIds: allProductIds, index: i, label: pageTitle }}
  // ... other props
/>
```

**Step 3: Commit**
```bash
git add apps/web/src/components/CatalogProductCard.tsx apps/web/src/components/CatalogProductsInfinite.tsx
git commit -m "feat(pdp): save nav context from catalog card clicks"
```

---

### Task 16: Lateral Navigation — PDP Component

**Files:**
- Create: `apps/web/src/components/pdp/PdpLateralNav.tsx`

**Step 1: Create the lateral nav component**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { readPdpNavContext } from "@/lib/pdp-nav-context";

type Props = {
  productId: string;
  /** Map of productId -> { brandSlug, slug } for building hrefs */
  productHrefs?: Record<string, { brandSlug: string; slug: string }>;
};

type NavState = {
  prevHref: string | null;
  nextHref: string | null;
  label: string;
  position: string; // "3 de 24"
};

export default function PdpLateralNav({ productId }: Props) {
  const [nav, setNav] = useState<NavState | null>(null);

  useEffect(() => {
    const ctx = readPdpNavContext(productId);
    if (!ctx) return;

    const { productIds, currentIndex, label } = ctx;

    // We need to resolve product IDs to URLs.
    // For simplicity, we store brandSlug+slug alongside IDs in context.
    // But since we only stored IDs, we fetch prev/next URLs from an API.
    const prevId = currentIndex > 0 ? productIds[currentIndex - 1] : null;
    const nextId = currentIndex < productIds.length - 1 ? productIds[currentIndex + 1] : null;

    if (!prevId && !nextId) return;

    // Fetch hrefs for prev/next
    const ids = [prevId, nextId].filter(Boolean) as string[];
    fetch(`/api/catalog/product-hrefs?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        setNav({
          prevHref: prevId ? data[prevId] ?? null : null,
          nextHref: nextId ? data[nextId] ?? null : null,
          label,
          position: `${currentIndex + 1} de ${productIds.length}`,
        });
      })
      .catch(() => {});
  }, [productId]);

  if (!nav) return null;

  return (
    <nav
      aria-label="Navegación entre productos"
      className="hidden items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] lg:flex"
    >
      {nav.prevHref ? (
        <Link
          href={nav.prevHref}
          prefetch
          className="flex items-center gap-1 transition hover:text-[color:var(--oda-ink)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </Link>
      ) : (
        <span className="flex items-center gap-1 opacity-30">
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </span>
      )}

      <span className="text-[color:var(--oda-ink-soft)]">{nav.position}</span>

      {nav.nextHref ? (
        <Link
          href={nav.nextHref}
          prefetch
          className="flex items-center gap-1 transition hover:text-[color:var(--oda-ink)]"
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className="flex items-center gap-1 opacity-30">
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </nav>
  );
}
```

**Step 2: Create API endpoint for resolving product IDs to hrefs**

Create `apps/web/src/app/api/catalog/product-hrefs/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) return NextResponse.json({});

  const ids = idsParam.split(",").slice(0, 10); // max 10

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true, brand: { select: { slug: true } } },
  });

  const result: Record<string, string> = {};
  for (const p of products) {
    if (p.slug && p.brand.slug) {
      result[p.id] = `/producto/${p.brand.slug}/${p.slug}`;
    }
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
```

**Step 3: Wire into PdpInteractiveSection**

Import and render at the top of the right column, before the brand link:

```typescript
import PdpLateralNav from "@/components/pdp/PdpLateralNav";
```

Render at the very top of the sticky sidebar:
```typescript
{/* Lateral navigation */}
<PdpLateralNav productId={product.id} />
```

**Step 4: Verify — navigate from catalog to a product, confirm arrows appear on desktop**

**Step 5: Commit**
```bash
git add apps/web/src/components/pdp/PdpLateralNav.tsx apps/web/src/app/api/catalog/product-hrefs/route.ts apps/web/src/components/pdp/PdpInteractiveSection.tsx
git commit -m "feat(pdp): add lateral navigation between products"
```

---

**Phase 2 checkpoint: Verify all Phase 2 features work. Run `npm run build` to check for type errors.**

---

## Phase 3 — Higher Complexity

### Task 17: Dynamic Outfit Suggestion — Category Mapping

**Files:**
- Create: `apps/web/src/lib/outfit-categories.ts`

**Step 1: Create category mapping for complementary suggestions**

```typescript
import { CATEGORY_GROUPS } from "@/lib/navigation";

/** Maps a product's category to complementary category groups for outfit suggestions */
export function getComplementaryCategories(
  category: string | null,
): string[][] {
  if (!category) return [];

  const tops = CATEGORY_GROUPS.Superiores as readonly string[];
  const bottoms = [...CATEGORY_GROUPS.Completos, ...CATEGORY_GROUPS.Inferiores] as string[];
  const shoes = ["calzado"];
  const accessories = [
    "bolsos_y_marroquineria",
    "joyeria_y_bisuteria",
    "gafas_y_optica",
    "accesorios_textiles_y_medias",
  ];

  const isTop = (tops as readonly string[]).includes(category);
  const isBottom = CATEGORY_GROUPS.Inferiores.includes(category as typeof CATEGORY_GROUPS.Inferiores[number]);
  const isDress = CATEGORY_GROUPS.Completos.includes(category as typeof CATEGORY_GROUPS.Completos[number]);
  const isShoe = category === "calzado";

  if (isTop) return [bottoms, shoes, accessories];
  if (isBottom) return [[...tops], shoes, accessories];
  if (isDress) return [shoes, accessories, ["bolsos_y_marroquineria"]];
  if (isShoe) return [[...tops], bottoms, accessories];

  // Default: suggest from different groups
  return [[...tops], shoes, accessories];
}
```

**Step 2: Commit**
```bash
git add apps/web/src/lib/outfit-categories.ts
git commit -m "feat(pdp): add category mapping for outfit suggestions"
```

---

### Task 18: Dynamic Outfit Suggestion — Data Query

**Files:**
- Modify: `apps/web/src/lib/pdp-data.ts`

**Step 1: Add outfit suggestion query**

Import helpers:
```typescript
import { getRotationSeed } from "@/lib/home-data";
import { getComplementaryCategories } from "@/lib/outfit-categories";
```

Add type:
```typescript
export type PdpOutfitItem = {
  id: string;
  name: string;
  slug: string | null;
  imageCoverUrl: string | null;
  brandName: string;
  brandSlug: string;
  category: string | null;
  minPrice: string | null;
  currency: string | null;
};
```

Add query:
```typescript
export async function getOutfitSuggestions(
  productId: string,
  options: {
    category: string | null;
    gender: string | null;
    realStyle: string | null;
  },
): Promise<PdpOutfitItem[]> {
  if (!options.category || !options.gender) return [];

  const cached = unstable_cache(
    async () => {
      const complementaryGroups = getComplementaryCategories(options.category);
      if (complementaryGroups.length === 0) return [];

      const seed = getRotationSeed();
      const results: PdpOutfitItem[] = [];

      for (let i = 0; i < complementaryGroups.length && results.length < 3; i++) {
        const categories = complementaryGroups[i];
        const offset = ((seed * 7919 + (i + 5000) * 104729) % 1000000) / 1000000;

        // Prefer same realStyle, fall back to same gender
        const styleFilter = options.realStyle
          ? Prisma.sql`AND p."real_style" = ${options.realStyle}`
          : Prisma.empty;

        const rows: Array<{
          id: string;
          name: string;
          slug: string | null;
          imageCoverUrl: string | null;
          brandName: string;
          brandSlug: string;
          category: string | null;
          minPrice: unknown;
          currency: string | null;
        }> = await prisma.$queryRaw`
          SELECT p.id, p.name, p.slug, p."imageCoverUrl",
                 b.name AS "brandName", b.slug AS "brandSlug",
                 p.category,
                 p."minPriceCop" AS "minPrice",
                 p.currency
          FROM products p
          JOIN brands b ON b.id = p."brandId"
          WHERE p.category IN (${Prisma.join(categories)})
            AND p.gender = ${options.gender}
            AND p.id <> ${productId}
            AND p."imageCoverUrl" IS NOT NULL
            AND p."hasInStock" = true
            AND b."isActive" = true
            AND p."random_sort_key" >= ${offset}
            ${styleFilter}
          ORDER BY p."random_sort_key"
          LIMIT 1
        `;

        if (rows[0]) {
          results.push({
            ...rows[0],
            minPrice: rows[0].minPrice?.toString() ?? null,
          });
        }
      }

      return results;
    },
    [`pdp-outfit-v1`, productId, String(getRotationSeed())],
    { revalidate: PDP_REVALIDATE_SECONDS * 3, tags: [CATALOG_CACHE_TAG] },
  );

  return cached();
}
```

Note: Import `Prisma` from `@prisma/client` if not already imported.

**Step 2: Commit**
```bash
git add apps/web/src/lib/pdp-data.ts
git commit -m "feat(pdp): add outfit suggestion data query"
```

---

### Task 19: Dynamic Outfit Suggestion — UI Component + Wiring

**Files:**
- Create: `apps/web/src/components/pdp/PdpOutfitSuggestion.tsx`
- Modify: `apps/web/src/app/producto/[brand]/[slug]/page.tsx`
- Modify: `apps/web/src/components/pdp/PdpLayout.tsx`

**Step 1: Create outfit suggestion component**

```typescript
import Image from "next/image";
import Link from "next/link";
import { proxiedImageUrl } from "@/lib/image-proxy";
import type { PdpOutfitItem } from "@/lib/pdp-data";

type Props = {
  items: PdpOutfitItem[];
};

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) return "Consultar";
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `${currency ?? "COP"} ${Number(amount).toFixed(0)}`;
  }
}

export default function PdpOutfitSuggestion({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="mt-10 lg:mt-14">
      <h2 className="mb-5 font-[family-name:var(--font-display)] text-lg tracking-[0.06em] text-[color:var(--oda-ink)]">
        Completa el look
      </h2>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {items.map((item) => {
          const imageSrc = proxiedImageUrl(item.imageCoverUrl, {
            productId: item.id,
            kind: "cover",
          });
          const href =
            item.slug && item.brandSlug
              ? `/producto/${item.brandSlug}/${item.slug}`
              : "#";

          return (
            <Link
              key={item.id}
              href={href}
              prefetch={false}
              className="group flex flex-col gap-2"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-[color:var(--oda-stone)]">
                {imageSrc && (
                  <Image
                    src={imageSrc}
                    alt={item.name}
                    fill
                    quality={55}
                    sizes="(max-width: 640px) 30vw, 20vw"
                    className="object-cover transition duration-500 group-hover:scale-[1.03]"
                  />
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="truncate text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  {item.brandName}
                </span>
                <span className="line-clamp-1 text-xs leading-snug text-[color:var(--oda-ink)]">
                  {item.name}
                </span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-ink-soft)]">
                  {formatPrice(item.minPrice, item.currency)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
```

**Step 2: Fetch outfit suggestions in page.tsx**

Add `getOutfitSuggestions` to the import and `Promise.all`:

```typescript
import { ..., getOutfitSuggestions } from "@/lib/pdp-data";
```

```typescript
  const [relatedProducts, priceInsight, priceHistory, outfitItems] = await Promise.all([
    getRelatedProducts(...),
    getPriceInsight(...),
    getPriceHistory(...),
    getOutfitSuggestions(product.id, {
      category: product.category,
      gender: product.gender,
      realStyle: product.realStyle,
    }),
  ]);
```

Pass to PdpLayout:
```typescript
<PdpLayout ... outfitItems={outfitItems} />
```

**Step 3: Render in PdpLayout before PdpBrandSection**

```typescript
import PdpOutfitSuggestion from "@/components/pdp/PdpOutfitSuggestion";
import type { ..., PdpOutfitItem } from "@/lib/pdp-data";
```

Add `outfitItems: PdpOutfitItem[]` to Props. Render:

```typescript
{/* Outfit suggestion */}
{outfitItems.length > 0 && (
  <PdpOutfitSuggestion items={outfitItems} />
)}

{/* Brand section */}
<PdpBrandSection brand={product.brand} />
```

**Step 4: Verify — check a product with category and gender set, confirm outfit items render**

**Step 5: Commit**
```bash
git add apps/web/src/components/pdp/PdpOutfitSuggestion.tsx apps/web/src/app/producto/[brand]/[slug]/page.tsx apps/web/src/components/pdp/PdpLayout.tsx
git commit -m "feat(pdp): add dynamic outfit suggestion section"
```

---

### Task 20: Price Alert — Prisma Schema

**Files:**
- Modify: `apps/web/prisma/schema.prisma`

**Step 1: Add PriceAlert model and enum**

Add after the `UserAuditEvent` model:

```prisma
enum PriceAlertStatus {
  ACTIVE
  TRIGGERED
  DISMISSED
}

model PriceAlert {
  id              String           @id @default(uuid())
  userId          String
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId       String
  product         Product          @relation(fields: [productId], references: [id], onDelete: Cascade)
  priceAtCreation Decimal          @db.Decimal(12, 2)
  status          PriceAlertStatus @default(ACTIVE)
  createdAt       DateTime         @default(now())
  triggeredAt     DateTime?

  @@unique([userId, productId])
  @@index([productId, status])
  @@map("price_alerts")
}
```

Add `priceAlerts PriceAlert[]` to the `User` model's relations.
Add `priceAlerts PriceAlert[]` to the `Product` model's relations.

**Step 2: Run migration**

```bash
cd apps/web && npx prisma migrate dev --name add-price-alerts
```

**Step 3: Commit**
```bash
git add apps/web/prisma/schema.prisma apps/web/prisma/migrations/
git commit -m "feat(pdp): add PriceAlert model to Prisma schema"
```

---

### Task 21: Price Alert — API Routes

**Files:**
- Create: `apps/web/src/app/api/user/price-alerts/route.ts`

**Step 1: Create price alerts API**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";

export async function GET(req: Request) {
  const session = await requireUser(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const alerts = await prisma.priceAlert.findMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      productId: true,
      priceAtCreation: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ alerts });
}

export async function POST(req: Request) {
  const session = await requireUser(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { productId } = body as { productId: string };

  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { minPriceCop: true },
  });

  if (!product || !product.minPriceCop) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const alert = await prisma.priceAlert.upsert({
    where: {
      userId_productId: {
        userId: session.user.id,
        productId,
      },
    },
    create: {
      userId: session.user.id,
      productId,
      priceAtCreation: product.minPriceCop,
      status: "ACTIVE",
    },
    update: {
      priceAtCreation: product.minPriceCop,
      status: "ACTIVE",
      triggeredAt: null,
    },
  });

  return NextResponse.json({ alert });
}

export async function DELETE(req: Request) {
  const session = await requireUser(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });

  await prisma.priceAlert.deleteMany({
    where: { userId: session.user.id, productId },
  });

  return NextResponse.json({ ok: true });
}
```

**Step 2: Commit**
```bash
git add apps/web/src/app/api/user/price-alerts/route.ts
git commit -m "feat(pdp): add price alerts API routes"
```

---

### Task 22: Price Alert — UI Component

**Files:**
- Create: `apps/web/src/components/pdp/PdpPriceAlert.tsx`

**Step 1: Create price alert button component**

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, Check } from "lucide-react";
import { useSession } from "@descope/nextjs-sdk/client";

type Props = {
  productId: string;
  currentPrice: string | null;
};

export default function PdpPriceAlert({ productId, currentPrice }: Props) {
  const { isAuthenticated } = useSession();
  const [alertActive, setAlertActive] = useState(false);
  const [priceDropped, setPriceDropped] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check if alert exists for this product
  useEffect(() => {
    if (!isAuthenticated) return;

    fetch("/api/user/price-alerts")
      .then((r) => r.json())
      .then((data) => {
        const alert = data.alerts?.find(
          (a: { productId: string; priceAtCreation: string }) =>
            a.productId === productId,
        );
        if (alert) {
          setAlertActive(true);
          // Check if price dropped
          if (
            currentPrice &&
            Number(currentPrice) < Number(alert.priceAtCreation)
          ) {
            setPriceDropped(true);
          }
        }
      })
      .catch(() => {});
  }, [isAuthenticated, productId, currentPrice]);

  const handleToggle = useCallback(async () => {
    if (!isAuthenticated) {
      window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    setLoading(true);
    try {
      if (alertActive) {
        await fetch(`/api/user/price-alerts?productId=${productId}`, {
          method: "DELETE",
        });
        setAlertActive(false);
        setPriceDropped(false);
      } else {
        await fetch("/api/user/price-alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
        setAlertActive(true);
      }
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, alertActive, productId]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={loading}
      className={`mt-2 flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[11px] uppercase tracking-[0.16em] transition ${
        priceDropped
          ? "border border-[color:var(--oda-gold)] bg-[color:var(--oda-gold)]/10 text-[color:var(--oda-ink)]"
          : alertActive
            ? "border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] text-[color:var(--oda-ink-soft)]"
            : "border border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] hover:border-[color:var(--oda-ink)] hover:text-[color:var(--oda-ink)]"
      }`}
    >
      {priceDropped ? (
        <>
          <Check className="h-3.5 w-3.5" />
          El precio bajó desde tu alerta
        </>
      ) : alertActive ? (
        <>
          <BellOff className="h-3.5 w-3.5" />
          Alerta activa
        </>
      ) : (
        <>
          <Bell className="h-3.5 w-3.5" />
          Avisarme si baja de precio
        </>
      )}
    </button>
  );
}
```

**Step 2: Commit**
```bash
git add apps/web/src/components/pdp/PdpPriceAlert.tsx
git commit -m "feat(pdp): add PdpPriceAlert toggle component"
```

---

### Task 23: Price Alert — Wire into PDP

**Files:**
- Modify: `apps/web/src/components/pdp/PdpInteractiveSection.tsx`

**Step 1: Import and render below CTA**

```typescript
import PdpPriceAlert from "@/components/pdp/PdpPriceAlert";
```

Render after the CTA + Favorite + Share row:

```typescript
{/* Price alert */}
<PdpPriceAlert productId={product.id} currentPrice={displayPrice} />
```

**Step 2: Verify — check that the alert button renders, click it, confirm it toggles state**

**Step 3: Run final build**

```bash
cd apps/web && npm run build
```

**Step 4: Commit**
```bash
git add apps/web/src/components/pdp/PdpInteractiveSection.tsx
git commit -m "feat(pdp): wire price alert into PDP"
```

---

**Phase 3 checkpoint: All 8 features implemented. Run `npm run build` and verify no type errors. Navigate to multiple product pages and verify each feature renders correctly.**
