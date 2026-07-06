import { Check, ChevronDown } from 'lucide-react'
import React from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

type SelectInputProps = {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  disabled?: boolean
  required?: boolean
}

type SelectOption = {
  value: string
  label: string
  disabled: boolean
}

type MenuPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
}

export function SelectInput({
  label,
  value,
  onChange,
  children,
  disabled,
  required,
}: SelectInputProps) {
  const labelID = useId()
  const selectID = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const options = useMemo(() => selectOptions(children), [children])
  const selected = options.find((option) => option.value === value) ?? options[0]

  function updateMenuPosition() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    const gap = 6
    const viewportPadding = 8
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding
    const availableAbove = rect.top - viewportPadding
    const openAbove = availableBelow < 160 && availableAbove > availableBelow
    const maxHeight = Math.min(256, Math.max(144, openAbove ? availableAbove - gap : availableBelow - gap))
    const top = openAbove ? Math.max(viewportPadding, rect.top - maxHeight - gap) : rect.bottom + gap
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding),
    )

    setMenuPosition({
      left,
      top,
      width: rect.width,
      maxHeight,
    })
  }

  useEffect(() => {
    if (!open) {
      return
    }
    updateMenuPosition()
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    function handleWindowChange() {
      updateMenuPosition()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [open])

  function selectValue(nextValue: string) {
    onChange(nextValue)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="block text-xs text-muted">
      <label id={labelID} htmlFor={selectID} className="mb-1 block">
        {label}
      </label>
      <select
        id={selectID}
        className="sr-only"
        tabIndex={-1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
      >
        {children}
      </select>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={`${label}: ${selected?.label ?? 'Select'}`}
        aria-controls={`${selectID}-menu`}
        aria-expanded={open}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm text-ink outline-none',
          'transition-[background-color,border-color,box-shadow] duration-150',
          'hover:border-coolgray-500 hover:bg-panel focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35',
          'disabled:pointer-events-none disabled:opacity-50',
          open && 'border-accent/60 bg-panel shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_22%,transparent)]',
        )}
        disabled={disabled}
        onClick={() => setOpen((state) => !state)}
      >
        <span className="min-w-0 truncate">{selected?.label ?? 'Select'}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && menuPosition && (
        <div
          id={`${selectID}-menu`}
          role="listbox"
          className="fixed z-50 overflow-auto rounded-md border border-coolgray-400 bg-background p-1 text-sm text-ink shadow-[0_14px_28px_rgba(0,0,0,0.22)]"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            minWidth: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={cn(
                'flex h-8 w-full items-center justify-between gap-3 rounded px-2 text-left outline-none transition-colors duration-150',
                option.value === value ? 'bg-coollabs-50 text-accent-text' : 'hover:bg-panel focus-visible:bg-panel',
                option.disabled && 'pointer-events-none opacity-45',
              )}
              disabled={option.disabled}
              onClick={() => selectValue(option.value)}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.value === value && <Check className="size-4 shrink-0 text-accent-text" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function selectOptions(children: React.ReactNode): SelectOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<{ value?: string; disabled?: boolean; children?: React.ReactNode }>(child)) {
      return []
    }
    const label = optionLabel(child.props.children)
    return [{
      value: String(child.props.value ?? label),
      label,
      disabled: Boolean(child.props.disabled),
    }]
  })
}

function optionLabel(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return React.Children.toArray(value).join('')
}
