import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/descope";
import { logExperienceEvent } from "@/lib/experience";
import {
  getBrandCurrencyOverride,
  getDisplayRoundingUnitCop,
  getPricingConfig,
  getUsdCopTrm,
  toCopEffective,
} from "@/lib/pricing";
import { shouldApplyMarketingRounding, toDisplayedCop } from "@/lib/price-display";

export async function GET(
  req: Request,
  context: { params: Promise<{ listId: string }> },
) {
  const params = await context.params;
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const list = await prisma.userList.findUnique({
    where: { id: params.listId },
  });

  if (!list || list.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const items = await prisma.userListItem.findMany({
    where: { listId: list.id },
    orderBy: { position: "asc" },
    include: { product: { include: { brand: true } }, variant: true },
  });

  const pricingConfig = await getPricingConfig();
  const trmUsdCop = getUsdCopTrm(pricingConfig);
  const displayUnitCop = getDisplayRoundingUnitCop(pricingConfig);

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      createdAt: item.createdAt,
      product: {
        id: item.product.id,
        name: item.product.name,
        imageCoverUrl: item.product.imageCoverUrl,
        sourceUrl: item.product.sourceUrl,
        currency: "COP",
        brand: item.product.brand ? { id: item.product.brand.id, name: item.product.brand.name } : null,
      },
      variant: item.variant
        ? {
            id: item.variant.id,
            price: (() => {
              const brandOverride = getBrandCurrencyOverride(item.product.brand?.metadata);
              const priceRaw = Number(item.variant!.price.toString());
              const effective = toCopEffective({
                price: Number.isFinite(priceRaw) ? priceRaw : null,
                currency: item.variant!.currency,
                brandOverride,
                trmUsdCop,
              });
              const applyMarketingRounding = shouldApplyMarketingRounding({
                brandOverride,
                sourceCurrency: item.variant!.currency,
              });
              const display = toDisplayedCop({
                effectiveCop: effective,
                applyMarketingRounding,
                unitCop: displayUnitCop,
              });
              return display ? String(display) : "0";
            })(),
            currency: "COP",
            color: item.variant.color,
            size: item.variant.size,
          }
        : null,
    })),
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ listId: string }> },
) {
  const params = await context.params;
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const list = await prisma.userList.findUnique({
    where: { id: params.listId },
  });

  if (!list || list.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    productId: string;
    variantId?: string | null;
    position?: number;
  };

  if (!body.productId) {
    return NextResponse.json({ error: "productId_required" }, { status: 400 });
  }

  const existing = await prisma.userListItem.findFirst({
    where: {
      listId: list.id,
      productId: body.productId,
      variantId: body.variantId ?? null,
    },
  });

  let item =
    existing ??
    (await prisma.userListItem.create({
      data: {
        listId: list.id,
        productId: body.productId,
        variantId: body.variantId ?? undefined,
        position: body.position ?? 0,
      },
    }));

  if (existing && body.position !== undefined) {
    item = await prisma.userListItem.update({
      where: { id: existing.id },
      data: { position: body.position },
    });
  }

  await logExperienceEvent({
    type: "list_item_add",
    userId: session.user.id,
    listId: list.id,
    productId: body.productId,
    variantId: body.variantId ?? undefined,
  });

  await prisma.userAuditEvent.create({
    data: {
      userId: session.user.id,
      action: "list_item_add",
      entityType: "list_item",
      entityId: item.id,
      metadata: { listId: list.id, productId: body.productId, variantId: body.variantId ?? null },
    },
  });

  return NextResponse.json({ item });
}
