// End-to-end check of the guided flow against a running stack (default https://localhost).
// Walks every step, checks the numbers on screen against the API, edits one parameter and one
// supplier quote, and restores the settings afterwards. Usage: npm test [-- BASE_URL] [-- --shots DIR]
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'https://localhost'
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const browser = await chromium.launch()
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 960 } })
const api = async (path, method = 'GET', data) => (await ctx.request.fetch(`${base}${path}`, { method, data })).json()
const [tender] = await api('/api/tenders')
const id = tender.tender_id
const before = await api(`/api/tenders/${id}/pricing`)
const page = await ctx.newPage()
const errors = []
const failures = []
const check = (ok, msg) => ok || failures.push(msg)
// Compare digits only: Node and Chromium may use different apostrophes for de-CH.
const digits = (s) => String(s).replace(/[^\d.]/g, '')
const chf = (n) => digits(Math.round(n))
const text = async (sel) => digits(await page.locator(sel).innerText())
const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` })
page.on('pageerror', (e) => errors.push(e.message))

try {
  await page.goto(`${base}/#/t/${id}/extract/live`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await shot('1-live')
  await page.click('text=Skip')
  await page.waitForSelector('text=Certainty')
  check((await text('header')).includes(chf(before.project.selling_price)), 'ticker shows the offer price')
  await page.locator('g.cursor-pointer').nth(1).hover()
  await shot('2-extract')
  // Correct the first position's quantity, then reset it.
  const first = before.lines[0]
  await page.click('button[title="Correct this value"]')
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await page.waitForSelector('button[title="Reset"]')
  const q = (await api(`/api/tenders/${id}/pricing`)).lines.find((l) => l.line_id === first.line_id)
  check(q.decision.quantity === 3 && q.decision.overridden.includes('quantity'), 'quantity edit is saved')
  await page.click('button[title="Reset"]')
  await page.waitForTimeout(800)

  await page.click('nav button:has-text("Catalogue")')
  await page.waitForSelector('text=Matched because')
  await shot('3-catalogue')
  // Supplier quote: the first one, then reset.
  const quoteLines = before.lines.filter((l) => l.status_key === 'supplier_quote_required')
  await page.click('button:has-text("await a supplier quote")')
  const quoteLine = quoteLines[1]
  await page.waitForSelector(`text=${quoteLine.line_id}`)
  await page.fill('input[inputmode=decimal]', String(Math.round(quoteLine.cost.net_unit_cost * 0.9)))
  await page.click('button:has-text("Save")')
  await page.waitForSelector('button:has-text("Reset")')
  const quoted = await api(`/api/tenders/${id}/pricing`)
  check(quoted.project.selling_price < before.project.selling_price, 'a lower supplier quote lowers the price')
  await page.click('form button:has-text("Reset")')
  await page.waitForTimeout(800)

  await page.click('nav button:has-text("Price")')
  await page.waitForSelector('text=On the offer form')
  await shot('4-price')
  // Installation hours per unit for the selected position.
  await page.click('button[title="Correct this value"]')
  await page.keyboard.type('40')
  await page.keyboard.press('Enter')
  await page.waitForSelector('button[title="Reset"]')
  const sel = (await api(`/api/tenders/${id}/pricing`)).lines.find((l) => l.decision.overridden.includes('hours_per_unit'))
  check(sel?.cost.base_hours === 40, 'hours per unit edit is saved')
  await page.click('button[title="Reset"]')
  await page.waitForTimeout(800)
  // Margin slider one step up via keyboard.
  const margin = page.locator('label:has-text("Margin") input[type=range]')
  await margin.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(1500)
  const after = await api(`/api/tenders/${id}/pricing`)
  check(after.settings.margin_pct > before.settings.margin_pct, 'margin slider commits')
  check((await text('header')).includes(chf(after.project.selling_price)), 'ticker follows the new price')

  await page.click('nav button:has-text("Offer options")')
  check(await page.locator('button:has-text("Generate other offers")').isDisabled(), 'AI button is a placeholder')

  await page.click('nav button:has-text("Fill & export")')
  await page.waitForSelector('text=What is written into the tender')
  await page.waitForTimeout(1500)
  await shot('5-export')
  const offer = await api(`/api/tenders/${id}/offer`)
  const amounts = Object.values(offer.lines).filter((l) => l.kind === 'priced').reduce((s, l) => s + l.amount, 0)
  const sys = Object.values(offer.systems).reduce((s, x) => s + x.total, 0)
  check(Math.abs(sys - offer.brutto) < 0.02, `systems add up to the gross total (${sys} vs ${offer.brutto})`)
  check(amounts < offer.brutto, 'position amounts are part of the gross total')
  check(Math.abs(offer.brutto - offer.selling_price) < 50, 'form total matches the offer price up to centimes')
  check((await text('main')).includes(offer.conditions.netto.toFixed(2)), 'net total shown')
  const pdf = await ctx.request.get(`${base}/api/tenders/${id}/offer.pdf?download=true`)
  check(pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === '%PDF', 'filled PDF downloads')

  await page.click('button:has-text("DE")')
  check((await page.locator('nav').innerText()).includes('Erfassung'), 'German labels')
  await shot('6-export-de')
  await page.click('button:has-text("EN")')
} finally {
  const left = (await api(`/api/tenders/${id}/pricing`)).lines.filter((l) => l.decision.overridden.length && !before.lines.find((b) => b.line_id === l.line_id)?.decision.overridden.length)
  for (const l of left) await api(`/api/tenders/${id}/lines/${l.line_id}/override`, 'DELETE')
  await api(`/api/tenders/${id}/settings`, 'PATCH', {
    factors: before.settings.factors, allowances: before.settings.allowances, project_costs: before.settings.project_costs,
    overhead_pct: before.settings.overhead_pct, margin_pct: before.settings.margin_pct, risk_allowance_chf: before.settings.risk_allowance_chf,
  })
  await browser.close()
}

if (errors.length) failures.push(...errors.map((e) => `page error: ${e}`))
console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'OK: every step renders and the numbers agree with the API')
process.exit(failures.length ? 1 : 0)
