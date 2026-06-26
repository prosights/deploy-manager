import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ImagePlus, Save } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { Button } from '../components/ui/button'
import { InlineError } from '../components/ui/error-message'
import { Panel } from '../components/ui/panel'
import { TextInput } from '../components/ui/text-input'
import { BrandingPreview, defaultBrandColor, settingsToForm } from '../features/settings/branding'
import { updateSettings, type UpdateSettingsInput } from '../lib/api'
import { settingsQuery } from '../lib/queries'

export function SettingsRoute() {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(settingsQuery)
  const [form, setForm] = useState<UpdateSettingsInput>(() => settingsToForm(settings))
  const [formError, setFormError] = useState<string>()
  const settingsKey = settingsFormKey(settings)
  const settingsKeyRef = useRef(settingsKey)

  useEffect(() => {
    if (settingsKeyRef.current === settingsKey) {
      return
    }
    settingsKeyRef.current = settingsKey
    setForm(settingsToForm(settings))
  }, [settings, settingsKey])

  const save = useMutation({
    mutationFn: () => updateSettings(settingsInput(form)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey })
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" description="White-label identity for this internal deployment manager." />
      <Panel title="Branding">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setFormError(undefined)
            try {
              validateSettingsForm(form)
            } catch (error) {
              setFormError(error instanceof Error ? error.message : 'Branding settings are invalid.')
              return
            }
            save.mutate()
          }}
        >
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <TextInput label="Name" value={form.name} onChange={(name) => setForm((state) => ({ ...state, name }))} required />
            <TextInput label="Short name" value={form.short_name} onChange={(short_name) => setForm((state) => ({ ...state, short_name }))} required />
            <ImageUrlInput label="Logo URL" value={form.logo_url} onChange={(logo_url) => setForm((state) => ({ ...state, logo_url }))} accept="image/*" />
            <ImageUrlInput label="Favicon URL" value={form.favicon_url} onChange={(favicon_url) => setForm((state) => ({ ...state, favicon_url }))} accept="image/*" />
            <ColorInput label="Primary color" value={form.primary_color} onChange={(primary_color) => setForm((state) => ({ ...state, primary_color }))} placeholder={defaultBrandColor} />
            <TextInput label="Docs URL" value={form.docs_url} onChange={(docs_url) => setForm((state) => ({ ...state, docs_url }))} />
            <label className="flex flex-col gap-1 text-xs text-muted md:col-span-2">
              <span>Meta description</span>
              <textarea
                className="min-h-24 resize-y rounded-md border bg-background px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
                value={form.meta_description}
                onChange={(event) => setForm((state) => ({ ...state, meta_description: event.target.value }))}
              />
            </label>
          </div>
          <div className="border-t">
            <div className="px-4 pt-4">
              <h3 className="text-sm font-semibold text-ink">Preview</h3>
              <p className="mt-1 text-sm text-muted">Review how the shell branding will look before applying it.</p>
            </div>
            <BrandingPreview form={form} />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t p-4">
            <Button variant="primary" disabled={save.isPending || !form.name || !form.short_name}>
              <Save className="size-4" />
              {save.isPending ? 'Applying...' : 'Apply settings'}
            </Button>
            {(formError || save.error) && <InlineError message={formError ?? save.error?.message ?? 'Branding settings could not be applied.'} />}
          </div>
        </form>
      </Panel>
    </div>
  )
}

function settingsFormKey(settings: UpdateSettingsInput): string {
  return [
    settings.name,
    settings.short_name,
    settings.meta_description,
    settings.logo_url,
    settings.favicon_url,
    settings.primary_color,
    settings.docs_url,
  ].join('\x00')
}

function ColorInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const inputId = useId()
  const resolved = value.trim() || placeholder || '#0980fd'
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(resolved)

  return (
    <div className="space-y-1 text-xs text-muted">
      <label htmlFor={inputId}>{label}</label>
      <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          value={isValidHex ? resolved : '#0980fd'}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          id={inputId}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/60"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}

function ImageUrlInput({ label, value, onChange, accept }: { label: string; value: string; onChange: (value: string) => void; accept?: string }) {
  const [dragOver, setDragOver] = useState(false)
  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }, [onChange])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) {
      handleFile(file)
    }
  }, [handleFile])

  const preview = value.trim()

  return (
    <div className="space-y-1 text-xs text-muted">
      <label htmlFor={inputId}>{label}</label>
      <div
        className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-background p-3 text-center transition-colors ${dragOver ? 'border-accent bg-accent/5' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {preview && (preview.startsWith('data:') || preview.startsWith('/') || preview.startsWith('http')) ? (
          <img src={preview} alt={`${label} preview`} className="max-h-8 max-w-full object-contain" />
        ) : (
          <ImagePlus className="size-5 text-muted" />
        )}
        <span className="text-xs text-muted">Drop image or click to browse</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        aria-label={`${label} file`}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            handleFile(file)
          }
          event.target.value = ''
        }}
      />
      <input
        id={inputId}
        className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
        value={value.startsWith('data:') ? '' : value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="/branding/logo.svg or drop image above"
      />
    </div>
  )
}

function validateSettingsForm(form: UpdateSettingsInput): void {
  if (!form.name.trim() || !form.short_name.trim()) {
    throw new Error('Name and short name are required.')
  }
  if (hasControlCharacters(form.name, form.short_name, form.meta_description)) {
    throw new Error('Branding text fields cannot contain control characters.')
  }
  const primaryColor = form.primary_color.trim() || defaultBrandColor
  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    throw new Error('Primary color must be a 6-digit hex color.')
  }
  validateBrandURL('Logo URL', form.logo_url, ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'])
  validateBrandURL('Favicon URL', form.favicon_url, ['.ico', '.png', '.svg'])
  validateBrandURL('Docs URL', form.docs_url)
}

function settingsInput(form: UpdateSettingsInput): UpdateSettingsInput {
  return {
    name: form.name.trim(),
    short_name: form.short_name.trim(),
    meta_description: form.meta_description.trim(),
    logo_url: form.logo_url.trim(),
    favicon_url: form.favicon_url.trim(),
    primary_color: form.primary_color.trim() || defaultBrandColor,
    docs_url: form.docs_url.trim() || '#',
  }
}

function validateBrandURL(label: string, value: string, allowedExtensions?: string[]): void {
  const trimmed = value.trim()
  if (!trimmed) {
    return
  }
  if (trimmed.startsWith('data:image/')) {
    return
  }
  if (trimmed === '#' && !allowedExtensions) {
    return
  }
  if (trimmed.startsWith('#')) {
    validateAssetExtension(label, trimmed, allowedExtensions)
    return
  }
  if (hasControlCharacters(trimmed)) {
    throw new Error(`${label} cannot contain control characters.`)
  }
  if (trimmed.startsWith('//')) {
    throw new Error(`${label} must be a relative path or absolute http(s) URL.`)
  }
  if (trimmed.startsWith('/')) {
    validateAssetExtension(label, trimmed, allowedExtensions)
    return
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${label} must be a relative path or absolute http(s) URL.`)
  }
  if (!parsed.host) {
    throw new Error(`${label} must be a relative path or absolute http(s) URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https.`)
  }
  validateAssetExtension(label, parsed.pathname, allowedExtensions)
}

function validateAssetExtension(label: string, path: string, allowedExtensions?: string[]): void {
  if (!allowedExtensions) {
    return
  }
  const normalized = path.toLowerCase().split(/[?#]/, 1)[0]
  if (allowedExtensions.some((extension) => normalized.endsWith(extension))) {
    return
  }
  throw new Error(`${label} must point to a supported image asset.`)
}

function hasControlCharacters(...values: string[]): boolean {
  return values.some((value) => value.includes('\n') || value.includes('\r') || value.includes('\t'))
}
