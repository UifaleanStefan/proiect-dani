import { defineConfig, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ServerResponse } from 'node:http'

// Manual-journal annotations live OUTSIDE public/ (so saving doesn't trigger an HMR
// reload) in a git-trackable repo-root folder. The dev/preview server exposes a tiny
// file API so the React journal page can auto-save and reload hand-marked setups.
const ANN_DIR = path.resolve(process.cwd(), 'journal-data', 'annotations')
// Per-trade chart screenshots (candles + the user's drawings) for the Excel export.
// Regenerable, large → gitignored; kept next to the annotations.
const PHOTO_DIR = path.resolve(process.cwd(), 'journal-data', 'photos')
const SAFE_ID = /^[0-9A-Za-z_-]+$/

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, code: number, payload: unknown) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
}

function journalApi(): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const url = req.url || ''
    if (!url.startsWith('/api/journal/')) return next()
    try {
      fs.mkdirSync(ANN_DIR, { recursive: true })

      // POST /api/journal/scan?market=&shift=  — raw CSV body → spawn the engine
      // (journal-only) to scan it, publish the grabs, and return the count.
      if (req.method === 'POST' && url.startsWith('/api/journal/scan')) {
        const u = new URL(url, 'http://localhost')
        const market = (u.searchParams.get('market') || 'MARKET').replace(/[^0-9A-Za-z_-]/g, '') || 'MARKET'
        const shift = String(parseInt(u.searchParams.get('shift') || '0', 10) || 0)
        const root = process.cwd()
        const uploads = path.resolve(root, 'journal-data', 'uploads')
        fs.mkdirSync(uploads, { recursive: true })
        const tmpCsv = path.join(uploads, `${market}_${Date.now()}.csv`)
        const ws = fs.createWriteStream(tmpCsv)
        ws.on('error', () => json(res, 500, { error: 'failed to write upload' }))
        ws.on('finish', () => {
          const py = path.resolve(root, 'engine', '.venv', 'Scripts', 'python.exe')
          const pub = path.resolve(root, 'public', 'engine-data')
          const out = path.resolve(root, 'engine', 'data', 'runs', `upload_${market}`)
          const args = ['-m', 'engine', '--csv', tmpCsv, '--market', market,
            '--shift-minutes', shift, '--journal-only', '--publish-to', pub, '--out', out]
          const child = spawn(py, args, {
            cwd: path.resolve(root, 'engine'),
            env: { ...process.env, PYTHONPATH: 'src' },
          })
          let errTail = ''
          child.stdout.on('data', (d) => { process.stdout.write(`[scan ${market}] ${d}`) })
          child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-4000) })
          child.on('error', (e) => json(res, 500, { error: String(e?.message || e) }))
          child.on('close', (code) => {
            try { fs.unlinkSync(tmpCsv) } catch { /* ignore */ }
            if (code !== 0) return json(res, 500, { error: 'engine scan failed', detail: errTail })
            let count = 0
            try {
              count = JSON.parse(fs.readFileSync(path.join(pub, 'journal', 'events.json'), 'utf-8')).meta.count
            } catch { /* ignore */ }
            json(res, 200, { ok: true, market, count })
          })
        })
        req.pipe(ws)
        return
      }

      // POST /api/journal/save/:id  — body is the annotation JSON
      if (req.method === 'POST' && url.startsWith('/api/journal/save/')) {
        const id = decodeURIComponent(url.slice('/api/journal/save/'.length).split('?')[0])
        if (!SAFE_ID.test(id)) return json(res, 400, { error: 'bad id' })
        const body = await readBody(req)
        let parsed: unknown
        try { parsed = JSON.parse(body || '{}') } catch { return json(res, 400, { error: 'bad json' }) }
        fs.writeFileSync(path.join(ANN_DIR, `${id}.json`), JSON.stringify(parsed, null, 2), 'utf-8')
        return json(res, 200, { ok: true })
      }

      // GET /api/journal/load/:id  — 404 → {} if not annotated yet
      if (req.method === 'GET' && url.startsWith('/api/journal/load/')) {
        const id = decodeURIComponent(url.slice('/api/journal/load/'.length).split('?')[0])
        if (!SAFE_ID.test(id)) return json(res, 400, { error: 'bad id' })
        const fp = path.join(ANN_DIR, `${id}.json`)
        if (!fs.existsSync(fp)) return json(res, 404, {})
        return json(res, 200, fs.readFileSync(fp, 'utf-8'))
      }

      // POST /api/journal/photo/:id  — body is a PNG data URL → write photos/:id.png
      if (req.method === 'POST' && url.startsWith('/api/journal/photo/')) {
        const id = decodeURIComponent(url.slice('/api/journal/photo/'.length).split('?')[0])
        if (!SAFE_ID.test(id)) return json(res, 400, { error: 'bad id' })
        const body = await readBody(req)
        const b64 = body.replace(/^data:image\/\w+;base64,/, '')
        try {
          fs.mkdirSync(PHOTO_DIR, { recursive: true })
          fs.writeFileSync(path.join(PHOTO_DIR, `${id}.png`), Buffer.from(b64, 'base64'))
        } catch (e) { return json(res, 500, { error: String((e as Error)?.message || e) }) }
        return json(res, 200, { ok: true })
      }

      // GET /api/journal/photo/:id  — serve the PNG (404 if none captured yet)
      if (req.method === 'GET' && url.startsWith('/api/journal/photo/')) {
        const id = decodeURIComponent(url.slice('/api/journal/photo/'.length).split('?')[0])
        if (!SAFE_ID.test(id)) return json(res, 400, { error: 'bad id' })
        const fp = path.join(PHOTO_DIR, `${id}.png`)
        if (!fs.existsSync(fp)) return json(res, 404, { error: 'no photo' })
        res.statusCode = 200
        res.setHeader('content-type', 'image/png')
        res.setHeader('cache-control', 'no-store')
        return res.end(fs.readFileSync(fp))
      }

      // GET /api/journal/index  — every saved annotation (for the manual-stats summary)
      if (req.method === 'GET' && url.startsWith('/api/journal/index')) {
        const files = fs.existsSync(ANN_DIR)
          ? fs.readdirSync(ANN_DIR).filter((f) => f.endsWith('.json'))
          : []
        const items = files
          .map((f) => {
            try {
              const j = JSON.parse(fs.readFileSync(path.join(ANN_DIR, f), 'utf-8'))
              return { id: f.replace(/\.json$/, ''), ...j }
            } catch { return null }
          })
          .filter(Boolean)
        return json(res, 200, items)
      }

      return json(res, 404, { error: 'not found' })
    } catch (e) {
      return json(res, 500, { error: String((e as Error)?.message || e) })
    }
  }

  return {
    name: 'journal-api',
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), journalApi()],
})
