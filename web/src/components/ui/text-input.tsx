export function TextInput({
  label,
  value,
  onChange,
  required,
  placeholder,
  disabled,
  list,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  placeholder?: string
  disabled?: boolean
  list?: string
}) {
  return (
    <label className="space-y-1 text-xs text-muted">
      <span>{label}</span>
      <input
        className="h-9 w-full rounded-prosights-lg border border-prosights-border bg-prosights-surface px-3 text-sm text-prosights-text outline-none placeholder:text-prosights-muted/60 focus-visible:border-prosights-text focus-visible:ring-2 focus-visible:ring-prosights-ring disabled:cursor-not-allowed disabled:opacity-60"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        list={list}
      />
    </label>
  )
}
