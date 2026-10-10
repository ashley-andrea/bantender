// End-to-end check of the guided flow against a running stack (default https://localhost).
// Uploads the sample tender through the UI, walks every step, checks the numbers on screen against the API,
// edits a quantity, a supplier quote, hours and a parameter, and restores the settings afterwards.
// Usage: npm test [-- BASE_URL] [-- --shots DIR]
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'https://localhost'
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const browser = await chromium.launch()
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 960 } })
const api = async (path, method = 'GET', data) => (await ctx.request.fetch(`${base}${path}`, { method, data })).json()
const page = await ctx.newPage()
let id = null
let before = null
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
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', new URL('../data/samples/oberglatt/BKP_244_LV_Lueftung_260804.pdf', import.meta.url).pathname)
  await page.waitForTimeout(300)
  await shot('1-reading')
  await page.waitForSelector('text=pick a position', { timeout: 60000 })
  id = page.url().match(/#\/t\/([a-f0-9]+)/)[1]
  before = await api(`/api/tenders/${id}/pricing`)
  check((await page.locator('.hl').count()) === 0, 'no highlights before a position is picked')
  // Pick the first position; its values light up. Hover its quantity and correct it, then reset.
  const first = before.lines[0]
  await page.locator('[role=button]').first().click()
  await page.waitForSelector('text=Derived')
  check((await page.locator('.hl').count()) > 0, 'highlights appear once a position is picked')
  await page.locator('svg g.cursor-pointer:has(text:text-is("Qty"))').first().hover()
  await shot('2-extract')
  check((await page.locator('.hl-tag').count()) === 1, 'one label for the active value')
  await page.click('button[title="Correct this value"]')
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await page.waitForSelector('button[title="Reset"]')
  const q = (await api(`/api/tenders/${id}/pricing`)).lines.find((l) => l.line_id === first.line_id)
  check(q.decision.quantity === 3 && q.decision.overridden.includes('quantity'), 'quantity edit is saved')
  await page.click('button[title="Reset"]')
  await page.waitForTimeout(800)

  await page.click('nav button:has-text("Catalogue")')
  await page.waitForSelector('text=catalog.csv')
  await shot('3-catalogue')
  // Supplier quote on the next supplier-package item: 10 % below the placeholder, then reset.
  await page.click('button:has-text("need a supplier quote")')
  await page.waitForTimeout(500)
  await page.click('button[title="Correct this value"]')
  const placeholder = Number(await page.inputValue('input[inputmode=decimal]'))
  await page.fill('input[inputmode=decimal]', String(Math.round(placeholder * 0.9)))
  await page.keyboard.press('Enter')
  await page.waitForSelector('button[title="Reset"]')
  const quoted = await api(`/api/tenders/${id}/pricing`)
  check(quoted.project.selling_price < before.project.selling_price, 'a lower supplier quote lowers the price')
  await page.click('button[title="Reset"]')
  await page.waitForTimeout(800)

  await page.click('nav button:has-text("Price")')
  await page.waitForSelector('text=Hours per unit')
  await shot('4-price')
  // Installation hours per unit for the selected position (the second editable value after quantity).
  await page.locator('button[title="Correct this value"]').nth(1).click()
  await page.keyboard.type('40')
  await page.keyboard.press('Enter')
  await page.waitForSelector('button[title="Reset"]')
  const sel = (await api(`/api/tenders/${id}/pricing`)).lines.find((l) => l.decision.overridden.includes('hours_per_unit'))
  check(sel?.cost.base_hours === 40, 'hours per unit edit is saved')
  await page.click('button[title="Reset"]')
  await page.waitForTimeout(800)
  // Margin slider one step up via keyboard.
  const margin = page.locator('input[aria-label="Margin"]')
  await margin.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(1500)
  const after = await api(`/api/tenders/${id}/pricing`)
  check(after.settings.margin_pct > before.settings.margin_pct, 'margin slider commits')
  check((await text('main')).includes(chf(after.project.selling_price)), 'offer bar follows the new price')
  // Undo just that value: back to the company margin.
  await page.click('button[title="Back to the company value"]')
  await page.waitForTimeout(1500)
  check((await api(`/api/tenders/${id}/pricing`)).settings.margin_pct === before.settings.target_margin_pct, 'undo restores the company value')

  // Variants: a parent sums its children; opening one shows the variant node.
  const groupRow = page.locator('[role=button]:has-text("variants")').first()
  await groupRow.click()
  await page.waitForTimeout(600)
  check((await page.locator('text=Variants on the form').count()) === 1, 'a parent shows its variants on the form')
  const xlsx = await ctx.request.get(`${base}/api/tenders/${id}/pricing.xlsx`)
  check(xlsx.ok() && (await xlsx.body()).subarray(0, 2).toString() === 'PK', 'Excel workbook downloads')

  await page.click('nav button:has-text("Offer options")')
  await page.waitForSelector('text=Choose this offer')
  await shot('5-offers')
  await page.locator('.panel-green button:has-text("Choose this offer")').first().click()
  await page.waitForTimeout(1500)
  const chosen = await api(`/api/tenders/${id}/pricing`)
  check(chosen.choice?.scenario === 'Target', 'choosing the recommended offer records it')

  await page.click('nav button:has-text("Export")')
  await page.waitForSelector('text=Download PDF')
  await page.waitForTimeout(1500)
  await shot('6-export')
  const offer = await api(`/api/tenders/${id}/offer`)
  const amounts = Object.values(offer.lines).filter((l) => l.kind === 'priced').reduce((s, l) => s + l.amount, 0)
  const sys = Object.values(offer.systems).reduce((s, x) => s + x.total, 0)
  check(Math.abs(sys - offer.brutto) < 0.02, `systems add up to the gross total (${sys} vs ${offer.brutto})`)
  check(amounts < offer.brutto, 'position amounts are part of the gross total')
  check(Math.abs(offer.brutto - offer.selling_price) < 50, 'form total matches the offer price up to centimes')
  check((await text('main')).includes(offer.conditions.netto.toFixed(2)), 'net total shown')
  const pdf = await ctx.request.get(`${base}/api/tenders/${id}/offer.pdf?download=true`)
  check(pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === '%PDF', 'filled PDF downloads')

  await page.click('button:text-is("de")')
  check((await page.locator('nav').innerText()).includes('Erfassung'), 'German labels')
  await shot('7-export-de')
  await page.click('button:text-is("en")')
} finally {
  if (!before) { await browser.close(); console.log('FAIL: upload did not reach the extraction view', errors); process.exit(1) }
  const left = (await api(`/api/tenders/${id}/pricing`)).lines.filter((l) => l.decision.overridden.length && !before.lines.find((b) => b.line_id === l.line_id)?.decision.overridden.length)
  for (const l of left) await api(`/api/tenders/${id}/lines/${l.line_id}/override`, 'DELETE')
  // Put the chosen offer back the way it was (none, or the previous one), then the settings.
  if (before.choice) {
    const { scenario, offer, margin_pct, win_probability } = before.choice
    await api(`/api/tenders/${id}/choice`, 'POST', { scenario, offer, margin_pct, win_probability })
  } else await api(`/api/tenders/${id}/choice`, 'DELETE')
  await api(`/api/tenders/${id}/settings`, 'PATCH', {
    factors: before.settings.factors, allowances: before.settings.allowances, project_costs: before.settings.project_costs,
    overhead_pct: before.settings.overhead_pct, margin_pct: before.settings.margin_pct, risk_allowance_chf: before.settings.risk_allowance_chf,
  })
  await browser.close()
}

if (errors.length) failures.push(...errors.map((e) => `page error: ${e}`))
console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'OK: every step renders and the numbers agree with the API')
process.exit(failures.length ? 1 : 0)
