import { cn } from '../../lib/cn'

// Underlined section tabs used in dialog and drawer headers.
export function Tabs<T extends string>({
  tabs,
  active,
  label,
  onSelect,
}: {
  tabs: ReadonlyArray<{ id: T, label: string }>
  active: T
  label: string
  onSelect: (tab: T) => void
}) {
  return (
    <nav className="mt-4 flex gap-6 overflow-x-auto" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={cn('relative h-10 shrink-0 bg-transparent px-0 text-[13px] font-medium transition-colors', active === tab.id ? 'text-prosights-text' : 'text-prosights-muted hover:text-prosights-text')}
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {active === tab.id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-prosights-text" />}
        </button>
      ))}
    </nav>
  )
}
