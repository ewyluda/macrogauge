export function Section({ title, children, featured = false, actions, id }: { title: string; children: React.ReactNode; featured?: boolean; actions?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={featured ? "section section-featured" : "section"}>
      <div className="section-heading">
        <h2 className="section-title">{title}</h2>
        {actions && <div className="chart-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
