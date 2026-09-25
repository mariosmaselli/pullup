import puppeteer from 'puppeteer-core'

const port = process.env.PORT || 4777
const headless = process.env.HEADFUL ? false : true
const extraArgs = (process.env.ARGS || '').split(' ').filter(Boolean)
const runs = JSON.parse(process.argv[2])

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless,
  args: ['--no-first-run', '--no-default-browser-check', ...extraArgs],
  protocolTimeout: 600000,
})
for (const params of runs) {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('console:', m.text())
  })
  const url = `http://localhost:${port}/${process.env.PAGE || ""}?${new URLSearchParams(params)}`
  await page.goto(url)
  await page.waitForFunction('window.__result', { timeout: 600000, polling: 500 })
  const r = await page.evaluate('window.__result')
  console.log(JSON.stringify({ params, ...r }))
  await page.close()
}
await browser.close()
