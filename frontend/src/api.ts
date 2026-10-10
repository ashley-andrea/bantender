import type { CatalogItem, Override, Parsed, Pricing, TenderSummary } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

const send = <T,>(url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) =>
    json<T>(r),
  )

export const api = {
  listTenders: () => fetch('/api/tenders').then((r) => json<TenderSummary[]>(r)),
  getTender: (id: string) => fetch(`/api/tenders/${id}`).then((r) => json<Parsed>(r)),
  getPricing: (id: string) => fetch(`/api/tenders/${id}/pricing`).then((r) => json<Pricing>(r)),
  override: (id: string, lineId: string, body: Override) => send<Pricing>(`/api/tenders/${id}/lines/${lineId}`, 'PATCH', body),
  resetLine: (id: string, lineId: string) => send<Pricing>(`/api/tenders/${id}/lines/${lineId}/override`, 'DELETE'),
  settings: (id: string, body: Record<string, unknown>) => send<Pricing>(`/api/tenders/${id}/settings`, 'PATCH', body),
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch('/api/tenders', { method: 'POST', body: form }).then((r) => json<TenderSummary>(r))
  },
  pdfUrl: (id: string) => `/api/tenders/${id}/pdf`,
  searchCatalog: (q: string) => fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`).then((r) => json<CatalogItem[]>(r)),
}
