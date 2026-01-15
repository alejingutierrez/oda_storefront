export const dynamic = "force-static";

export default function AdminHome() {
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
