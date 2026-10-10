import type { CatalogContext, Offer, Parsed, Pricing, ReferenceParameters, TenderSummary } from './types'

export type EditField = 'quantity' | 'unit_price' | 'hours_per_unit'

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

/** Tender data fetched during upload, handed to the flow so the extraction view opens without a second wait. */
export const prefetched = new Map<string, { parsed: Parsed; pricing: Pricing }>()

export const api = {
  reference: () => fetch('/api/reference').then((r) => json<{ version: string; parameters: ReferenceParameters }>(r)),
  listTenders: () => fetch('/api/tenders').then((r) => json<TenderSummary[]>(r)),
  getTender: (id: string) => fetch(`/api/tenders/${id}`).then((r) => json<Parsed>(r)),
  getPricing: (id: string) => fetch(`/api/tenders/${id}/pricing`).then((r) => json<Pricing>(r)),
  getOffer: (id: string) => fetch(`/api/tenders/${id}/offer`).then((r) => json<Offer>(r)),
  catalog: (productId: string) => fetch(`/api/catalog/${productId}`).then((r) => json<CatalogContext>(r)),
  override: (id: string, lineId: string, body: { quantity?: number; unit_price?: number; unit_price_source?: string; hours_per_unit?: number; note?: string }) =>
    send<Pricing>(`/api/tenders/${id}/lines/${lineId}`, 'PATCH', body),
  resetLine: (id: string, lineId: string, field?: EditField) =>
    send<Pricing>(`/api/tenders/${id}/lines/${lineId}/override${field ? `?field=${field}` : ''}`, 'DELETE'),
  settings: (id: string, body: Record<string, unknown>) => send<Pricing>(`/api/tenders/${id}/settings`, 'PATCH', body),
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch('/api/tenders', { method: 'POST', body: form }).then((r) => json<TenderSummary>(r))
  },
  pdfUrl: (id: string) => `/api/tenders/${id}/pdf`,
  offerPdfUrl: (id: string, download = false, v = 0) => `/api/tenders/${id}/offer.pdf?download=${download}&v=${v}`,
}
