import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateExperienceSubject, getRequestMeta } from "@/lib/experience";
import { getDescopeSession } from "@/lib/descope";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    type?: string;
    path?: string;
    referrer?: string;
    utm?: Record<string, unknown>;
    productId?: string;
    variantId?: string;
    brandId?: string;
    listId?: string;
    sessionId?: string;
    properties?: Record<string, unknown>;
  };

  if (!body.type) {
    return NextResponse.json({ error: "type_required" }, { status: 400 });
  }

  const normalizeJson = (value: unknown) =>
    value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

  const subject = await getOrCreateExperienceSubject();
  let authInfo = null;
  try {
    authInfo = await getDescopeSession();
  } catch (error) {
    console.error("Descope session unavailable", error);
  }
  const token = authInfo?.token && typeof authInfo.token === "object" ? authInfo.token : null;
  const descopeUserId = token && typeof token.sub === "string" ? token.sub : null;

  let userId: string | null = null;
  if (descopeUserId) {
    const user = await prisma.user.findUnique({ where: { descopeUserId } });
    userId = user?.id ?? null;
  }

  const meta = getRequestMeta();
  const propertiesPayload = {
    ...(body.properties ?? {}),
    userAgent: meta.userAgent,
  };
  const properties =
    Object.keys(propertiesPayload).length > 0 ? normalizeJson(propertiesPayload) : undefined;
  const utm = normalizeJson(body.utm);

  const event = await prisma.experienceEvent.create({
    data: {
      subjectId: subject.id,
      userId,
      type: body.type,
      path: body.path ?? undefined,
      referrer: body.referrer ?? meta.referrer,
      utm,
      productId: body.productId ?? undefined,
      variantId: body.variantId ?? undefined,
      brandId: body.brandId ?? undefined,
      listId: body.listId ?? undefined,
      sessionId: body.sessionId ?? undefined,
      properties,
    },
  });

  return NextResponse.json({ id: event.id });
}
