import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Self-hosting",
  description: "Run a Codeplane server on your VPS or homelab. systemd units, Docker, reverse proxies, auth, and TLS — every supported path documented.",
  alternates: { canonical: "/docs/self-hosting/" },
  openGraph: {
    title: "Self-hosting · Codeplane",
    description: "Run a Codeplane server on your VPS or homelab. systemd units, Docker, reverse proxies, auth, and TLS — every supported path documented.",
    url: "/docs/self-hosting/",
    type: "article",
  },
  twitter: {
    title: "Self-hosting · Codeplane",
    description: "Run a Codeplane server on your VPS or homelab. systemd units, Docker, reverse proxies, auth, and TLS — every supported path documented.",
    card: "summary_large_image",
  },
}

export default function SelfHosting() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/self-hosting/">
        <h1>Self-hosting</h1>
        <p className="lede">
          Run a Codeplane <Link href="/docs/instances/">instance</Link> on a box you own, then
          point every desktop / mobile / browser client at it. One instance, one set of
          sessions, every device. You can run several side-by-side (different ports, different
          state roots) when you want isolated environments.
        </p>

        <h2>Minimum requirements</h2>
        <ul>
          <li>Linux x86_64 or arm64 (also runs on macOS / Windows; Linux is the focus).</li>
          <li>1 GB RAM idle; 2-4 GB peak — <em>per instance</em>.</li>
          <li>Outbound HTTPS to your model provider.</li>
          <li>Inbound TCP on the bind port you choose, typically 4096.</li>
          <li>A real auth boundary before exposing the instance beyond loopback.</li>
        </ul>

        <h2>Install</h2>
        <pre><code>{`curl -fsSL https://codeplane.cc/install | bash`}</code></pre>
        <p>Pin a version in production with the installer&apos;s version flag, or install a specific npm version such as <code>codeplane-ai@28.18.0</code>.</p>

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
CODEPLANE_HOME_DIR=/var/lib/codeplane
CODEPLANE_LOG_DIR=/var/log/codeplane
CODEPLANE_SERVER_PASSWORD=change-me`}</code></pre>
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
  -e CODEPLANE_SERVER_PASSWORD=change-me \\
  -v codeplane-data:/data \\
  -e CODEPLANE_HOME_DIR=/data \\
  ghcr.io/devinoldenburg/codeplane:latest \\
  serve --port 4096 --hostname 0.0.0.0`}</code></pre>

        <h2>Authentication</h2>
        <ol>
          <li><strong>HTTP Basic Auth</strong>. Pass <code>--password</code> or set <code>CODEPLANE_SERVER_PASSWORD</code>. The username defaults to <code>codeplane</code> and can be changed with <code>--username</code> or <code>CODEPLANE_SERVER_USERNAME</code>.</li>
          <li><strong>Reverse proxy auth</strong>. mTLS, OIDC, Cloudflare Access, Tailscale Funnel, or a private VPN can terminate auth upstream.</li>
        </ol>
        <p>
          Codeplane refuses to bind a non-loopback hostname without a password. Keep that behavior
          in place; it protects provider credentials, MCP tools, plugins, terminals, and session
          history.
        </p>

        <h2>Backups</h2>
        <p>State lives in <code>$CODEPLANE_HOME_DIR</code>:</p>
        <ul>
          <li><code>data/codeplane.db</code> — SQLite, every message, tool call, permission record, and projector state.</li>
          <li><code>codeplane.jsonc</code>, <code>plugins/</code>, <code>agents/</code>, <code>commands/</code>, <code>skills/</code> — config and extensions.</li>
          <li><code>cache/</code> — safe to drop, rebuilds.</li>
          <li><code>log/</code> — useful for support, not required for restore.</li>
        </ul>
        <p><code>sqlite3 "$CODEPLANE_HOME_DIR/data/codeplane.db" &quot;.backup &apos;/backup/codeplane.db&apos;&quot;</code> works on a running server.</p>

        <h2>Upgrading</h2>
        <pre><code>{`sudo systemctl stop codeplane
sudo codeplane upgrade
sudo systemctl start codeplane
sudo journalctl -fu codeplane`}</code></pre>
        <p>
          For npm-managed installs, upgrade with <code>npm install -g codeplane-ai@latest</code>.
          For managed local runtimes used by desktop/TUI, run <code>codeplane instance local update</code>.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
