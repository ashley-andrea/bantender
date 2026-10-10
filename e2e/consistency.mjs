// UI consistency check against a running stack (default https://localhost):
// for every lot, every status chip's count equals the rows it shows, chips sum to all rows,
// and the header's unpriced count equals the unpriced list. Usage: npm test [-- BASE_URL]
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'https://localhost'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1680, height: 1000 } })
const api = async (path) => (await ctx.request.get(`${base}${path}`)).json()
const [tender] = await api('/api/tenders')
const pricing = await api(`/api/tenders/${tender.tender_id}/pricing`)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`${base}/#/t/${tender.tender_id}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

const rows = () => page.locator('table').first().locator('tbody tr').count()
const failures = []
const lots = Object.entries(pricing.tender.lots)
const lotButtons = lots.length > 1 ? ['All lots', ...lots.map(([n, l]) => `Lot ${n}${l.name ? ` · ${l.name}` : ''}`)] : [null]
for (const lot of lotButtons) {
  if (lot) await page.click(`button:has-text("${lot}")`)
  await page.waitForTimeout(200)
  const all = await rows()
  const chips = page.locator('button:has(span.num)').filter({ hasText: /Needs price|Missing info|Review|Supplier quote|Assumption|Calculated|Excluded/ })
  let sum = 0
  for (let i = 0; i < (await chips.count()); i++) {
    const chip = chips.nth(i)
    const n = Number((await chip.innerText()).match(/(\d+)\s*$/)?.[1] ?? 0)
    sum += n
    if (!n) continue
    await chip.click()
    await page.waitForTimeout(100)
    const r = await rows()
    if (r !== n) failures.push(`${lot ?? 'all'} / ${(await chip.innerText()).trim()}: chip ${n}, rows ${r}`)
    await chip.click()
    await page.waitForTimeout(100)
  }
  if (sum !== all) failures.push(`${lot ?? 'all'}: chips sum ${sum}, rows ${all}`)
}
if (lots.length > 1) await page.click('button:has-text("All lots")')
await page.click('button:has-text("unpriced")')
await page.waitForTimeout(200)
const unpriced = await rows()
if (unpriced !== pricing.summary.tender.unpriced) failures.push(`unpriced: header ${pricing.summary.tender.unpriced}, rows ${unpriced}`)
await browser.close()

if (errors.length) failures.push(...errors.map((e) => `page error: ${e}`))
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : `OK: ${lotButtons.length} lot views, chips match rows, unpriced = ${unpriced}`)
process.exit(failures.length ? 1 : 0)
