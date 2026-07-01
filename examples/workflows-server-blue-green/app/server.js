const http = require('node:http')

const port = Number(process.env.PORT || 8080)
const version = process.env.APP_VERSION || 'local'
const color = process.env.DEPLOY_COLOR || 'none'
const startedAt = new Date()

function json(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Workflows Server ${version}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0c0f;
      --panel: #151820;
      --line: #252a35;
      --ink: #f8fafc;
      --muted: #a8b0bd;
      --blue: #2f8cff;
      --green: #24c27a;
      --accent: ${color === 'green' ? 'var(--green)' : 'var(--blue)'};
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 28%, transparent), transparent 34rem), var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    main {
      width: min(920px, calc(100vw - 32px));
      border: 1px solid var(--line);
      border-radius: 14px;
      background: color-mix(in srgb, var(--panel) 92%, transparent);
      padding: 32px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 20px;
    }
    .mark {
      width: 13px;
      height: 13px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 16%, transparent);
    }
    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.1;
      text-wrap: balance;
    }
    p {
      margin: 8px 0 0;
      color: var(--muted);
      line-height: 1.6;
      max-width: 68ch;
    }
    dl {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
      margin: 24px 0 0;
    }
    div.metric {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 16px;
      background: #10131a;
    }
    dt {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 8px;
    }
    dd {
      margin: 0;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 15px;
      overflow-wrap: anywhere;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
      border-radius: 999px;
      padding: 8px 12px;
      color: var(--ink);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      white-space: nowrap;
    }
    @media (max-width: 640px) {
      main { padding: 22px; }
      .top { align-items: flex-start; flex-direction: column; }
      h1 { font-size: 25px; }
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div>
        <h1>Workflows Server</h1>
        <p>Blue-green rollout target. Build a new tag, deploy it to the idle color, then flip traffic without recreating the active container.</p>
      </div>
      <div class="pill"><span class="mark"></span>${color}</div>
    </div>
    <dl>
      <div class="metric"><dt>Version</dt><dd>${version}</dd></div>
      <div class="metric"><dt>Color</dt><dd>${color}</dd></div>
      <div class="metric"><dt>Started</dt><dd>${startedAt.toISOString()}</dd></div>
      <div class="metric"><dt>Host</dt><dd>${process.env.HOSTNAME || 'unknown'}</dd></div>
    </dl>
  </main>
</body>
</html>`
}

const server = http.createServer((request, response) => {
  if ((request.url || '').startsWith('/healthz')) {
    json(response, 200, { ok: true, version, color, started_at: startedAt.toISOString() })
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(page())
})

server.listen(port, '0.0.0.0', () => {
  console.log(`workflows-server ${version} (${color}) listening on ${port}`)
})
