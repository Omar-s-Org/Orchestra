/** Temporary page body used while the app is built step by step. */
export function StepPlaceholder({ title, step }: { title: string; step: string }) {
  return (
    <div className="p-8">
      <div className="rounded-xl border bg-card p-6 shadow-card">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">This screen arrives in {step}.</p>
      </div>
    </div>
  );
}
