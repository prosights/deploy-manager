export function PageHeader({ title, description }: { title: string, description: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-prosights-muted">{description}</p>
      </div>
    </div>
  )
}
