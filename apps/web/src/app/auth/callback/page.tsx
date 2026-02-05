import { redirect } from "next/navigation";
import { syncUserFromDescope } from "@/lib/descope";
import { logExperienceEvent } from "@/lib/experience";

export const dynamic = "force-dynamic";

const normalizeNext = (value?: string | string[] | null) => {
  if (!value || Array.isArray(value)) return "/perfil";
  if (!value.startsWith("/") || value.startsWith("//")) return "/perfil";
  if (value.startsWith("/auth/callback")) return "/perfil";
  return value;
};

export default async function AuthCallback({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const next = normalizeNext(searchParams?.next ?? null);

  const synced = await syncUserFromDescope();
  if (!synced) {
    const params = new URLSearchParams({ next });
    redirect(`/sign-in?${params.toString()}`);
  }

  await logExperienceEvent({
    type: "auth_login",
    userId: synced.user.id,
    subjectId: synced.subject.id,
    properties: {
      providerCount: Object.keys(synced.descopeUser.OAuth ?? {}).length,
    },
  });

  redirect(next);
}
