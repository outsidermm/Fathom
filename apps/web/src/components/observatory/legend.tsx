export function Legend() {
  return <aside aria-label="Feature map legend" className="absolute bottom-3 right-3 z-10 max-w-52 rounded-lg border border-deep-ink/20 bg-abyss/90 px-3 py-2 font-body text-xs text-deep-ink shadow-lg">
    <p className="mb-1 font-ui font-bold">Map key</p>
    <div className="flex items-center gap-1"><span>Weak</span>{[1,2,3,4,5].map((i) => <span key={i} className="inline-block size-2 rounded-full" style={{ backgroundColor: `var(--glow-${i})` }} />)}<span>Strong activation</span></div>
    <div className="mt-2 flex items-center gap-2"><span className="inline-block size-3 rounded-full border-2 border-clamp-up" />Clamped +</div>
    <div className="mt-1 flex items-center gap-2"><span className="inline-block size-3 rounded-full border-2 border-clamp-down" />Clamped −</div>
    <div className="mt-1 flex items-center gap-2"><span className="text-alert">⚠</span>Flagged token</div>
  </aside>;
}
