import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import React, { useId } from 'react'
import { cn } from '../../lib/cn'

// The one select control. Children are plain <option> elements, rendered as a
// Radix select so the menu matches the rest of the UI.

type SelectInputProps = {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  labelHidden?: boolean
  required?: boolean
}

// Radix reserves the empty string, so an empty option uses this stand-in.
const emptyValue = '__select_empty_value__'

export function SelectInput({
  label,
  value,
  onChange,
  children,
  className,
  disabled,
  labelHidden,
  required,
}: SelectInputProps) {
  const labelID = useId()

  return (
    <div className={cn('block text-xs text-prosights-muted', className)}>
      <label id={labelID} className={cn('mb-1 block', labelHidden && 'sr-only')}>
        {label}
      </label>
      <SelectPrimitive.Root
        value={value || emptyValue}
        onValueChange={(nextValue) => onChange(nextValue === emptyValue ? '' : nextValue)}
        disabled={disabled}
        required={required}
      >
        <SelectPrimitive.Trigger
          aria-labelledby={labelID}
          className="flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-prosights-md border border-prosights-border bg-prosights-surface px-3 text-[13px] text-prosights-text shadow-xs outline-none transition-[color,box-shadow,background-color] hover:bg-prosights-surface-muted focus-visible:border-prosights-subtle focus-visible:ring-[3px] focus-visible:ring-prosights-ring disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-prosights-muted [&_svg]:pointer-events-none [&_svg]:shrink-0"
        >
          <SelectPrimitive.Value placeholder="Select" />
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="size-4 text-prosights-muted" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            align="start"
            className="relative z-50 max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-prosights-md border border-prosights-border bg-prosights-surface text-prosights-text shadow-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:translate-y-1 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:-translate-x-1 data-[side=left]:slide-in-from-right-2 data-[side=right]:translate-x-1 data-[side=right]:slide-in-from-left-2 data-[side=top]:-translate-y-1 data-[side=top]:slide-in-from-bottom-2"
          >
            <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
              <ChevronUp className="size-4" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1 p-1">
              {selectOptions(children).map((option) => (
                <SelectPrimitive.Item
                  key={option.value || emptyValue}
                  value={option.value || emptyValue}
                  disabled={option.disabled}
                  className="relative flex w-full cursor-default select-none items-center gap-2 rounded-prosights-sm py-1.5 pl-2 pr-8 text-[13px] outline-none focus:bg-prosights-surface-muted focus:text-prosights-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <span className="absolute right-2 flex size-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
              <ChevronDown className="size-4" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  )
}

function selectOptions(children: React.ReactNode) {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<{ value?: string, disabled?: boolean, children?: React.ReactNode }>(child)) return []
    const label = optionLabel(child.props.children)
    return [{ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) }]
  })
}

function optionLabel(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return React.Children.toArray(value).join('')
}
