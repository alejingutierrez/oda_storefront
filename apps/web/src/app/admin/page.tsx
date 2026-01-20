import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import AdminShell from "./AdminShell";

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
    <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Panel en construcción</h2>
        <p className="mt-3 max-w-2xl text-sm text-slate-600">
          Aquí vivirá la consola para revisar scrapers, datos normalizados, aprobaciones y configuración de IA.
        </p>
        <div className="mt-6">
          <p className="text-sm font-medium text-slate-800">Próximo:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Revisar respuestas JSON de GPT-5.2 para normalización.</li>
            <li>Listar jobs de scraping e ingestión con su estado.</li>
            <li>Panel de aprobaciones manuales de producto.</li>
          </ul>
        </div>
      </section>
      <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Accesos rápidos</h3>
        <p className="mt-2 text-sm text-slate-600">Gestiona marcas y ejecuta scraping bajo demanda.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="/admin/brands"
            className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Ver directorio de marcas
          </a>
          <a
            href="/admin/brands/scrape"
            className="inline-flex rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Ir a scraping
          </a>
          <a
            href="/admin/brands/tech"
            className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Tech profiler
          </a>
          <a
            href="/admin/products"
            className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Ver productos
          </a>
          <a
            href="/admin/catalog-extractor"
            className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Catalog extractor
          </a>
        </div>
      </aside>
    </div>
  );
}

export default async function AdminHome() {
  const authed = await isAdminSession();
  return authed ? (
    <AdminShell title="Dashboard" active="dashboard">
      <AdminPanel />
    </AdminShell>
  ) : (
    <LoginForm />
  );
}
