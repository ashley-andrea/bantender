// Screenshots for the README, taken read-only from a running stack (default the live site).
// Usage: node shots.mjs [BASE_URL] [OUT_DIR], then python3 frame.py [OUT_DIR] for the corners and the sticker.
// esteban-assistant.png is not taken here (it comes from the pitch slides).
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'https://bantender.duckdns.org'
const out = process.argv[3] ?? new URL('../docs/img', import.meta.url).pathname
const browser = await chromium.launch()
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 960 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts })

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await shot('landing-intro')
await page.mouse.click(5, 900)
await page.waitForTimeout(1500)
await shot('landing')
await page.click('button:has-text("Recent")')
await page.waitForTimeout(900)
await shot('landing-recent')
// Esteban with "The usual?": the bartender and the bubble, bottom right.
const vh = 960, imgH = 0.25 * vh, imgW = imgH * 500 / 580
await shot('esteban-usual', { clip: { x: 1600 - imgW - 40 - 170, y: vh - imgH - 28 - 60, width: imgW + 40 + 170, height: imgH + 28 + 60 } })

await page.locator('main button:has-text("pages")').first().click()
await page.waitForSelector('text=pick a position', { timeout: 60000 })
await page.waitForTimeout(1500)
await page.locator('[role=button]').first().click()
await page.waitForSelector('text=Derived')
await page.waitForTimeout(1200)
await page.locator('svg g.cursor-pointer:has(text:text-is("Qty"))').first().hover()
await page.waitForTimeout(800)
await shot('1-extraction')
// A parent with variants.
await page.locator('[role=button]:has-text("variants")').first().click()
await page.waitForTimeout(1200)
await shot('1-variants')

await page.click('nav button:has-text("Catalogue")')
await page.waitForSelector('text=catalog.csv')
await page.waitForTimeout(1200)
await shot('2-catalogue')

await page.click('nav button:has-text("Price")')
await page.waitForSelector('text=Hours per unit')
await page.waitForTimeout(1500)
await shot('3-price')

await page.click('nav button:has-text("AI bid optimization")')
await page.waitForSelector('text=Choose this offer')
await page.waitForTimeout(1500)
await shot('4-offer-options')

await page.click('nav button:has-text("Export")')
await page.waitForSelector('text=Download PDF')
await page.waitForTimeout(3000)
await shot('5-export')

await browser.close()
console.log('done', out)
