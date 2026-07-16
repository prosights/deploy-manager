import React, { useId, useMemo } from 'react'
import { cn } from '../../lib/cn'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

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

type SelectOption = {
  value: string
  label: string
  disabled: boolean
}

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
  const options = useMemo(() => selectOptions(children), [children])

  return (
    <div className={cn('block text-xs text-prosights-muted', className)}>
      <label id={labelID} className={cn('mb-1 block', labelHidden && 'sr-only')}>
        {label}
      </label>
      <Select
        value={value || emptyValue}
        onValueChange={(nextValue) => onChange(nextValue === emptyValue ? '' : nextValue)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger className="w-full" aria-labelledby={labelID}>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent align="start">
          {options.map((option) => (
            <SelectItem key={option.value || emptyValue} value={option.value || emptyValue} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return React.Children.toArray(value).join('')
}
