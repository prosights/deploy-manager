import { Badge } from '../../components/ui/badge'
import type { CSSProperties } from 'react'
import type { UpdateSettingsInput } from '../../lib/api'

export const defaultBrandColor = '#0980fd'

export function BrandingPreview({ form }: { form: UpdateSettingsInput }) {
  const previewStyle = {
    '--color-accent': previewColor(form.primary_color),
    '--color-accent-text': previewColor(form.primary_color),
  } as CSSProperties

  return (
    <div className="flex flex-col gap-4 p-4" style={previewStyle}>
      <div className="flex items-center gap-3 rounded-md border bg-background p-3">
        <BrandMark logoUrl={form.logo_url} shortName={form.short_name} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{form.short_name || 'Deploy'}</div>
          <div className="truncate text-sm text-muted">{form.name || 'Deploy Manager'}</div>
        </div>
      </div>
      <div className="rounded-md border bg-background p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Deployment status</div>
          <Badge tone="accent">branded</Badge>
        </div>
        <div className="h-2 rounded-full bg-panel">
          <div className="h-2 rounded-full bg-accent" style={{ width: '68%' }} />
        </div>
        <p className="mt-3 text-sm leading-6 text-muted">{form.meta_description || 'Internal deployment control plane'}</p>
      </div>
    </div>
  )
}

function previewColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : defaultBrandColor
}

export function settingsToForm(settings: UpdateSettingsInput): UpdateSettingsInput {
  return {
    name: settings.name,
    short_name: settings.short_name,
    meta_description: settings.meta_description,
    logo_url: settings.logo_url,
    favicon_url: settings.favicon_url,
    primary_color: settings.primary_color || defaultBrandColor,
    docs_url: settings.docs_url,
  }
}

function BrandMark({ logoUrl, shortName }: { logoUrl: string; shortName: string }) {
  if (logoUrl.trim() !== '') {
    return (
      <div className="flex size-10 items-center justify-center">
        <img className="max-h-8 max-w-8 object-contain" src={logoUrl} alt="" />
      </div>
    )
  }

  return (
    <div className="flex size-10 items-center justify-center text-sm font-semibold text-ink">
      {(shortName || 'D').slice(0, 1).toUpperCase()}
    </div>
  )
}
