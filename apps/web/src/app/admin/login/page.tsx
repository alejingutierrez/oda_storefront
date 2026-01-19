export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
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
