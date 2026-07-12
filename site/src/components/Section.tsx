export function Section({ title, children, featured = false }: { title: string; children: React.ReactNode; featured?: boolean }) {
  return (
    <section className={featured ? "section section-featured" : "section"}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}
