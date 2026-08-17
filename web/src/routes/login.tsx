import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError, login } from '../lib/api'
import { queryClient } from '../lib/query-client'
import { Button } from '../components/ui/button'

export function LoginRoute() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await login(token.trim())
      queryClient.clear()
      await navigate({ to: '/projects' })
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Invalid token.' : 'Login failed. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-prosights-canvas p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-prosights-xl border border-prosights-border bg-prosights-surface p-6"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <img className="logo-mark size-8 object-contain" src="/branding/prosights/prosights-co-logo.png" alt="" />
          <div>
            <h1 className="text-[16px] font-semibold leading-5 text-prosights-text">Deploy Manager</h1>
            <p className="text-[12px] text-prosights-muted">Sign in with your API token</p>
          </div>
        </div>
        <label className="mb-1.5 block text-[12px] font-medium text-prosights-muted" htmlFor="api-token">
          API token
        </label>
        <input
          id="api-token"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste the API token"
          className="h-9 w-full rounded-prosights-lg border border-prosights-border bg-prosights-surface px-3 text-sm text-prosights-text outline-none placeholder:text-prosights-muted/60 focus-visible:border-prosights-text focus-visible:ring-2 focus-visible:ring-prosights-ring"
        />
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        <Button type="submit" className="mt-4 w-full" disabled={pending || !token.trim()}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
