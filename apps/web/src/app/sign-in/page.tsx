import { Suspense } from "react";
import SignInClient from "@/app/sign-in/SignInClient";

function SignInFallback() {
  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <div className="oda-container flex min-h-screen flex-col items-center justify-center gap-8 py-16">
        <div className="w-full max-w-md rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_30px_80px_rgba(23,21,19,0.12)]">
          <div className="flex min-h-[360px] items-center justify-center">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Cargando login…
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  // `useSearchParams()` en App Router requiere Suspense cuando causa CSR bailout.
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInClient />
    </Suspense>
  );
}
