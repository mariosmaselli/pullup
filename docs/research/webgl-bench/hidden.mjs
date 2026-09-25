import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-first-run'], protocolTimeout: 600000,
})
for (const pageName of ['', 'worker.html']) {
  const a = await browser.newPage()
  await a.goto(`http://localhost:4777/${pageName}?mode=encode&dur=15&video=1&name=hidden_${pageName||'main'}.mp4`)
  const b = await browser.newPage()
  await b.goto('about:blank')
  await b.bringToFront()
  await new Promise(r => setTimeout(r, 300))
  const vis = await a.evaluate('document.visibilityState')
  const t0 = Date.now()
  await a.waitForFunction('window.__result', { timeout: 600000, polling: 500 })
  const r = await a.evaluate('window.__result')
  console.log(pageName || 'main', 'visibility:', vis, 'fps', r.fps, 'totalMs', r.totalMs, r.error || '')
  await a.close(); await b.close()
}
await browser.close()
