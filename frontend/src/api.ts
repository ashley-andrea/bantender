import type { Parsed, TenderSummary } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listTenders: () => fetch('/api/tenders').then((r) => json<TenderSummary[]>(r)),
  getTender: (id: string) => fetch(`/api/tenders/${id}`).then((r) => json<Parsed>(r)),
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch('/api/tenders', { method: 'POST', body: form }).then((r) => json<TenderSummary>(r))
  },
  pdfUrl: (id: string) => `/api/tenders/${id}/pdf`,
}
