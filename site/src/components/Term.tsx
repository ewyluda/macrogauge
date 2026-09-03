import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/** Inline glossary term: dotted underline, the definition in the native
 *  tooltip, and a link to the glossary entry for keyboard and touch readers
 *  (a title alone is mouse-only). Server-safe. */
export function Term({ k, children }: { k: GlossaryKey; children?: React.ReactNode }) {
  const g = GLOSSARY[k];
  return (
    <a href={`/methodology#term-${k}`} className="term" title={g.def} aria-label={`${g.term}: ${g.def}`}>
      {children ?? g.term}
    </a>
  );
}

export function GlossaryList() {
  return (
    <dl className="glossary">
      {(Object.keys(GLOSSARY) as GlossaryKey[]).map((k) => (
        <div key={k} id={`term-${k}`} className="glossary-row">
          <dt>{GLOSSARY[k].term}</dt>
          <dd>{GLOSSARY[k].def}</dd>
        </div>
      ))}
    </dl>
  );
}
