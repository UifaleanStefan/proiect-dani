import { defineConfig, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import type { ServerResponse } from 'node:http'

// Manual-journal annotations live OUTSIDE public/ (so saving doesn't trigger an HMR
// reload) in a git-trackable repo-root folder. The dev/preview server exposes a tiny
// file API so the React journal page can auto-save and reload hand-marked setups.
const ANN_DIR = path.resolve(process.cwd(), 'journal-data', 'annotations')
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
