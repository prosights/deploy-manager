import { create } from 'zustand'

export type ToastTone = 'success' | 'danger' | 'info'

export type Toast = {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

type ToastState = {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => number
  dismiss: (id: number) => void
}

const toastLifetimeMs = 5000
const maxVisibleToasts = 5
let nextToastID = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextToastID++
    set((state) => ({ toasts: [...state.toasts.slice(-(maxVisibleToasts - 1)), { ...toast, id }] }))
    setTimeout(() => get().dismiss(id), toastLifetimeMs)
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

// Imperative helpers so mutation callbacks can report outcomes without
// threading the store through every component.
export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push({ tone: 'success', title, description }),
  error: (title: string, description?: string) => useToastStore.getState().push({ tone: 'danger', title, description }),
  info: (title: string, description?: string) => useToastStore.getState().push({ tone: 'info', title, description }),
}
