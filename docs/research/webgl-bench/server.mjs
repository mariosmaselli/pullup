import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)
const port = Number(process.env.PORT || 4777)
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    if (req.method === 'POST' && url.pathname === '/save') {
      const name = path.basename(url.searchParams.get('name') || 'out.bin')
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        fs.writeFileSync(path.join(root, 'out', name), Buffer.concat(chunks))
        res.end('ok')
      })
      return
    }
    const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404
      return res.end('nf')
    }
    const stat = fs.statSync(file)
    const type = types[path.extname(file)] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-')
      const start = Number(s)
      const end = e ? Number(e) : stat.size - 1
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      })
      fs.createReadStream(file, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, () => console.log('listening', port))
