export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-900">
      <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-24">
        <div className="flex flex-col gap-4">
          <p className="text-sm uppercase tracking-[0.2em] text-indigo-500">
            ODA Storefront · MVP
          </p>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            Moda colombiana unificada: 500 marcas, catálogo vivo, IA y
            recomendaciones.
          </h1>
          <p className="max-w-3xl text-lg text-slate-700">
            Plataforma headless en Next.js + Vue Storefront, scrapers y workers
            como servicios Node, ingestión con GPT-5.1 en JSON mode y catálogo
            normalizado en Neon + pgvector. Todo preparado para despliegue en
            Vercel y pipelines de recomendación.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Estado actual</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>✓ Estructura base Next.js (App Router, TS, Tailwind)</li>
              <li>✓ Servicios web/scraper/worker listos para correr sin Docker</li>
              <li>✓ Placeholders de scraper y worker listos para extender</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Próximos pasos</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>→ Definir taxonomía inicial y publicar catálogos</li>
              <li>→ Integrar búsqueda + pgvector y primeras 10–20 marcas</li>
              <li>→ Versionar prompts GPT-5.1 y monitorear costos</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
