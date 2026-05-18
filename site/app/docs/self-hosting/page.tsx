import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "Self-hosting" }

export default function SelfHosting() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/self-hosting/">
        <h1>Self-hosting</h1>
        <p className="lede">Run a Codeplane server on a box you own, then point every desktop / mobile / browser at it. One server, one set of sessions, every device.</p>

        <h2>Minimum requirements</h2>
        <ul>
          <li>Linux x86_64 or arm64 (also runs on macOS / Windows; Linux is the focus).</li>
          <li>1 GB RAM idle; 2-4 GB peak.</li>
          <li>Outbound HTTPS to your model provider.</li>
          <li>Inbound TCP on the bind port (default 4096).</li>
        </ul>

        <h2>Install</h2>
        <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
        <p>Pin a version in production with <code>-v 28.2.3</code>.</p>

        <h2>systemd</h2>
        <pre><code>{`# /etc/systemd/system/codeplane.service
[Unit]
Description=Codeplane server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=codeplane
Group=codeplane
EnvironmentFile=/etc/codeplane.env
ExecStart=/usr/local/bin/codeplane serve --port 4096 --hostname 127.0.0.1
Restart=on-failure
RestartSec=3
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target`}</code></pre>
        <p>Secrets in <code>/etc/codeplane.env</code> (mode <code>0600</code>):</p>
        <pre><code>{`ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
CODEPLANE_HOME=/var/lib/codeplane
CODEPLANE_LOG_LEVEL=INFO`}</code></pre>
        <pre><code>{`sudo useradd -r -m -d /var/lib/codeplane codeplane
sudo systemctl daemon-reload
sudo systemctl enable --now codeplane`}</code></pre>

        <h2>Reverse proxy (nginx)</h2>
        <pre><code>{`server {
  listen 443 ssl http2;
  server_name codeplane.example.com;

  ssl_certificate     /etc/letsencrypt/live/codeplane.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/codeplane.example.com/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:4096;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_buffering    off;
    proxy_read_timeout 24h;
    chunked_transfer_encoding off;
  }
}`}</code></pre>

        <h2>Reverse proxy (Caddy)</h2>
        <pre><code>{`codeplane.example.com {
  reverse_proxy 127.0.0.1:4096 {
    flush_interval -1
  }
}`}</code></pre>

        <h2>Docker</h2>
        <pre><code>{`docker run -d --name codeplane \\
  -p 4096:4096 \\
  -e ANTHROPIC_API_KEY=sk-ant-... \\
  -v codeplane-data:/data \\
  -e CODEPLANE_HOME=/data \\
  ghcr.io/devinoldenburg/codeplane:latest \\
  serve --port 4096 --hostname 0.0.0.0`}</code></pre>

        <h2>Authentication</h2>
        <ol>
          <li><strong>Bearer token</strong>. Pass <code>--auth &lt;token&gt;</code>; clients send <code>Authorization: Bearer &lt;token&gt;</code>.</li>
          <li><strong>Reverse proxy auth</strong>. mTLS, OIDC, Cloudflare Access, Tailscale Funnel — terminate auth upstream.</li>
        </ol>

        <h2>Backups</h2>
        <p>State lives in <code>$CODEPLANE_HOME</code>:</p>
        <ul>
          <li><code>sessions.db</code> — SQLite, every message + tool call + permission record.</li>
          <li><code>config/</code> — merged config + auth tokens.</li>
          <li><code>cache/</code> — safe to drop, rebuilds.</li>
        </ul>
        <p><code>sqlite3 sessions.db &quot;.backup &apos;/backup/codeplane.db&apos;&quot;</code> works on a running server.</p>

        <h2>Upgrading</h2>
        <pre><code>{`sudo systemctl stop codeplane
sudo codeplane upgrade
sudo systemctl start codeplane
sudo journalctl -fu codeplane`}</code></pre>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
