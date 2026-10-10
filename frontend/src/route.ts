/** The five steps of the flow, in order; also the last segment of the URL (#/t/<id>/<step>). */
export const STEPS = ['extract', 'catalog', 'price', 'offers', 'export'] as const
export type Step = (typeof STEPS)[number]
