import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function isAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_session")?.value;
  if (!token) return false;
  const tokenHash = hashToken(token);
  const admin = await prisma.user.findFirst({
    where: {
      role: "admin",
      sessionTokenHash: tokenHash,
    },
    select: { id: true },
  });
  return !!admin;
}

function LoginForm() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">ODA Admin</p>
          <h1 className="mt-2 text-2xl font-semibold">Iniciar sesión</h1>
          <p className="mt-2 text-sm text-slate-400">
            Accede con tu correo y contraseña de administrador.
          </p>

          <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400" htmlFor="email">
                Correo
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="admin@oda.com"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function AdminPanel() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <p className="text-xs uppercase tracking-[0.2em] text-indigo-500">Admin · ODA</p>
        <h1 className="mt-2 text-3xl font-semibold">Panel en construcción</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600">
          Aquí vivirá la consola para revisar scrapers, datos normalizados, aprobaciones y configuración de IA. Por ahora es un
          placeholder para MC-004/005.
        </p>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-800">Próximo:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Revisar respuestas JSON de GPT-5.2 para normalización.</li>
            <li>Listar jobs de scraping e ingestión con su estado.</li>
            <li>Panel de aprobaciones manuales de producto.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

export default async function AdminHome() {
  const authed = await isAdminSession();
  return authed ? <AdminPanel /> : <LoginForm />;
}
