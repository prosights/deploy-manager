import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, useToastStore } from './toasts'

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes toasts with tones and dismisses them by id', () => {
    const id = toast.success('Deployment queued', 'Follow progress on the Deployments page.')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      tone: 'success',
      title: 'Deployment queued',
    })

    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('auto-dismisses toasts after their lifetime', () => {
    toast.error('Could not deploy web')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('caps the number of visible toasts', () => {
    for (let index = 0; index < 8; index++) {
      toast.info(`Toast ${index}`)
    }
    const titles = useToastStore.getState().toasts.map((item) => item.title)
    expect(titles).toHaveLength(5)
    expect(titles[titles.length - 1]).toBe('Toast 7')
  })
})
