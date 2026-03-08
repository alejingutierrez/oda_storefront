# PDP Intelligence — Design Doc

**Date**: 2026-03-07
**Goal**: Transform the PDP into a retention-focused discovery hub with richer information, while maintaining Zara-like editorial design.
**Model**: ODA is an aggregator — no cart, no checkout. CTA redirects to brand store.

---

## Approved Features (8)

### 1. Subtle Price History

**Location**: Below current price in `PdpPriceDisplay`.

**Behavior**:
- Micro-sparkline (SVG ~60x16px, color `--oda-taupe`) showing 90-day trend
- Text line: "Precio más bajo en 30 días" or "Precio más bajo registrado" (gold)
- If < 7 days of history, hide entirely
- Data computed server-side from `PriceHistory` table
- No interactive tooltip — purely visual indicator

**Data needed**: Aggregate query on `PriceHistory` for the product's last 90 days.

---

### 2. Materials Card + Distinction Badges

**Location**: Badges above product name. Materials inside expanded `PdpAccordionSection`.

**Distinction Badges** (horizontal strip):
- "Real Style" if `realStyle = true` — star icon
- "Top Pick" if `topPick = true` — gold badge
- "Editor Favorite" if applicable
- Typography: `font-display`, uppercase, tracking wide
- Only render badges that apply

**Materials Card**:
- Icons per material type (cotton, polyester, linen, etc.)
- Country of origin (`origin` field) if present
- Pattern tags (`patternTags`) as visual descriptors

---

### 3. Best Price Badge

**Location**: Pill/chip next to price.

**Logic**:
- Current price <= min(last 30 days from `PriceHistory`) → "Mejor precio"
- Discount >= 30% → "Gran descuento"
- Only ONE badge at a time (priority: best price > big discount)
- Style: `--oda-gold` background, `--oda-ink` text
- Computed server-side

---

### 4. Dynamic Outfit Suggestion ("Completa el look")

**Location**: New section after product info, before `PdpBrandSection`.

**Behavior**:
- Shows 3 complementary products from same `stylePrimary` and `gender`
- Category logic:
  - Top → bottom + shoes + accessory
  - Bottom → top + shoes + accessory
  - Dress → shoes + accessory + bag
  - Shoes → top + bottom + accessory
- Uses rotation seed (`getRotationSeed()`) for dynamic variety
- Query per complementary category:
  ```sql
  WHERE stylePrimary = :style
    AND gender = :gender
    AND categoryGroup IN :complementaryCategories
    AND random_sort_key >= :offset
  ORDER BY random_sort_key LIMIT 1
  ```
- Layout: 3 horizontal cards, aspect ratio 3:4, editorial style
- Title: "Completa el look" in `font-display`

---

### 5. Occasion Pills

**Location**: Below distinction badges or inside specs section.

**Behavior**:
- Horizontal scrollable pills from `occasionTags`
- Each pill links to `/{gender}?occasion={tag}` (filtered catalog)
- Style: border `--oda-border`, text `--oda-ink-soft`, hover bg `--oda-stone`
- Typography: `font-body`, uppercase, tracking `0.1em`, text-xs
- Max 5 visible, horizontal scroll on mobile
- Hidden if no `occasionTags`

---

### 6. Price Alert (Registration Only)

**Location**: Below CTA button, as secondary action.

**Behavior**:
- Button: "Avisarme si baja de precio"
- Requires authentication (redirect to sign-in if not logged in)
- Registers alert in new `PriceAlert` table
- After registration, button changes to "Alerta activa"
- When user revisits and price dropped below `priceAtCreation`, show badge: "El precio bajó desde tu alerta!"
- Notification mechanism (email/push) deferred to future phase

**New model**:
```prisma
model PriceAlert {
  id              String   @id @default(cuid())
  userId          String
  productId       String
  priceAtCreation Float
  status          PriceAlertStatus @default(ACTIVE)
  createdAt       DateTime @default(now())
  triggeredAt     DateTime?

  user    User    @relation(fields: [userId], references: [id])
  product Product @relation(fields: [productId], references: [id])

  @@unique([userId, productId])
  @@index([productId, status])
}

enum PriceAlertStatus {
  ACTIVE
  TRIGGERED
  DISMISSED
}
```

**API**:
- `POST /api/user/price-alerts` — create alert
- `GET /api/user/price-alerts` — list user's alerts
- `DELETE /api/user/price-alerts/[id]` — remove alert

---

### 7. Add to List from PDP

**Location**: Next to favorite button, same action row.

**Behavior**:
- Bookmark icon opens popover dropdown with user's lists
- Shows list name + item count, check mark if product already in list
- "Crear nueva lista" opens inline input in same dropdown
- Reuses existing API: `POST /api/user/lists/[id]/items`
- Requires authentication
- Subtle animation on add (similar to favorite heartbeat)

---

### 8. Lateral Navigation ← →

**Location**: Upper right corner of PDP, desktop only.

**Behavior**:
- When arriving from catalog/PLP, store product ID list + current index in `sessionStorage`
- Arrows navigate to previous/next product in that list
- If user arrived directly (URL, search engine), arrows hidden
- Prefetch next product with `<Link prefetch>`
- Style: text `--oda-taupe`, hover `--oda-ink`, small font-body
- No loop — arrow disappears at list boundaries
- Mobile: not shown (user uses native back/swipe)

---

## Implementation Priority

### Phase 1 — Quick wins (low complexity, high retention)
1. **#3** Best Price Badge — server-side only, no new UI components
2. **#5** Occasion Pills — straightforward, data already in DB
3. **#2** Materials + Badges — data exists, just UI work

### Phase 2 — Medium complexity
4. **#1** Subtle Price History — needs sparkline SVG generation
5. **#7** Add to List — API exists, needs popover UI
6. **#8** Lateral Navigation — needs sessionStorage context tracking

### Phase 3 — Higher complexity
7. **#4** Dynamic Outfit Suggestion — new queries, category mapping logic
8. **#6** Price Alert — new DB model, new API routes, auth integration

---

## Design Tokens Reference

| Token | Value | Usage |
|-------|-------|-------|
| `--oda-ink` | `#171513` | Primary text |
| `--oda-ink-soft` | `#2a2724` | Secondary text |
| `--oda-cream` | `#fbf8f3` | Background |
| `--oda-stone` | `#f1ede7` | Secondary bg |
| `--oda-taupe` | `#b9a895` | Tertiary text |
| `--oda-gold` | `#d9c3a0` | Accents |
| `--oda-border` | `#e6dfd5` | Borders |
| `--oda-love` | `#c1121f` | Favorites |
| `font-display` | Bodoni Moda | Headlines |
| `font-body` | Outfit | Body text |

## Files to Modify

**Existing**:
- `apps/web/src/app/producto/[brand]/[slug]/page.tsx` — add new data fetching
- `apps/web/src/lib/pdp-data.ts` — new queries for price history, outfit suggestions
- `apps/web/src/components/pdp/PdpPriceDisplay.tsx` — sparkline, best price badge
- `apps/web/src/components/pdp/PdpAccordionSection.tsx` — materials expansion
- `apps/web/src/components/pdp/PdpSpecsTable.tsx` — materials icons
- `apps/web/src/components/pdp/PdpLayout.tsx` — new sections layout
- `apps/web/src/components/pdp/PdpInteractiveSection.tsx` — add list button
- `apps/web/prisma/schema.prisma` — PriceAlert model

**New**:
- `apps/web/src/components/pdp/PdpDistinctionBadges.tsx`
- `apps/web/src/components/pdp/PdpOccasionPills.tsx`
- `apps/web/src/components/pdp/PdpOutfitSuggestion.tsx`
- `apps/web/src/components/pdp/PdpPriceAlert.tsx`
- `apps/web/src/components/pdp/PdpAddToList.tsx`
- `apps/web/src/components/pdp/PdpLateralNav.tsx`
- `apps/web/src/components/pdp/PdpPriceSparkline.tsx`
- `apps/web/src/app/api/user/price-alerts/route.ts`
- `apps/web/src/app/api/user/price-alerts/[id]/route.ts`
