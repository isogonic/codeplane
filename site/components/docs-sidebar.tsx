import Link from "next/link"

/*
 * Docs navigation. Sticky on >= lg; on small screens it collapses into a
 * flat `<details>` disclosure (no bordered box). Every docs route —
 * including the Overview and Install pages — shares this sidebar via
 * DocsLayout, so the chrome is identical across the whole /docs tree.
 *
 * Link states: inactive = muted, hover lifts to ink with a faint
 * surface fill + hairline left-marker; active = ink text, bold, surface
 * fill, and a solid ink left-marker so "you are here" reads instantly.
 */
const OVERVIEW = { href: "/docs/", label: "Overview" }

const sections = [
  {
    title: "Get started",
    items: [
      { href: "/docs/install/",       label: "Install" },
      { href: "/docs/quickstart/",    label: "Quick start" },
      { href: "/docs/configuration/", label: "Configuration" },
      { href: "/docs/providers/",     label: "Providers" },
    ],
  },
  {
    title: "Surfaces",
    items: [
      { href: "/docs/tui/",     label: "Terminal (TUI)" },
      { href: "/docs/desktop/", label: "Desktop" },
      { href: "/docs/web/",     label: "Web" },
      { href: "/docs/mobile/",  label: "Mobile" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/cli/",          label: "CLI commands" },
      { href: "/docs/instances/",    label: "Instances" },
      { href: "/docs/sessions/",     label: "Sessions" },
      { href: "/docs/permissions/",  label: "Permissions" },
      { href: "/docs/keybinds/",     label: "Keybinds" },
      { href: "/docs/api/",          label: "HTTP API" },
      { href: "/docs/architecture/", label: "Architecture" },
    ],
  },
  {
    title: "Extend",
    items: [
      { href: "/docs/mcp/",             label: "MCP servers" },
      { href: "/docs/plugins/",         label: "Plugins" },
      { href: "/docs/sdk/",             label: "TypeScript SDK" },
      { href: "/docs/self-hosting/",    label: "Self-hosting" },
      { href: "/docs/themes/",          label: "Themes" },
      { href: "/docs/troubleshooting/", label: "Troubleshooting" },
    ],
  },
  {
    title: "Releases",
    items: [
      { href: "/docs/release/",   label: "Release process" },
      { href: "/docs/changelog/", label: "Changelog" },
    ],
  },
] as const

function findCurrentLabel(active?: string): string | null {
  if (!active) return null
  if (active === OVERVIEW.href) return OVERVIEW.label
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href === active) return `${section.title} · ${item.label}`
    }
  }
  return null
}

function NavLink({ href, label, active }: { href: string; label: string; active?: string }) {
  const isActive = active === href
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`block rounded-[var(--radius-md)] px-3 py-[7px] text-[13.5px] leading-snug transition-colors ${
        isActive
          ? "bg-surface-3 font-medium text-ink"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  )
}

function SidebarBody({ active }: { active?: string }) {
  return (
    <nav className="flex flex-col gap-7">
      <NavLink href={OVERVIEW.href} label={OVERVIEW.label} active={active} />
      {sections.map((section) => (
        <div key={section.title}>
          <h5 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
            {section.title}
          </h5>
          <ul className="flex flex-col">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href} label={item.label} active={active} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function DocsSidebar({ active }: { active?: string }) {
  const currentLabel = findCurrentLabel(active)
  return (
    <>
      {/*
       * Mobile/tablet (< lg): flat, collapsed-by-default `<details>` so
       * the full TOC doesn't push the doc below the fold. Summary shows
       * the current page; click to expand.
       */}
      <details className="group mb-8 border-b border-line pb-3 lg:hidden">
        <summary className="flex cursor-pointer list-none select-none items-center gap-2 text-[13px] text-ink-muted hover:text-ink">
          <span className="inline-block w-3 text-center text-ink-muted group-open:hidden">+</span>
          <span className="hidden w-3 text-center text-ink-muted group-open:inline-block">−</span>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink">Docs</span>
          {currentLabel ? <span className="text-ink-muted">/ {currentLabel}</span> : null}
        </summary>
        <div className="-ml-px mt-4">
          <SidebarBody active={active} />
        </div>
      </details>

      {/*
       * Desktop (>= lg): always-visible sticky sidebar.
       */}
      <aside className="hidden self-start lg:sticky lg:top-[72px] lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-2">
        <SidebarBody active={active} />
      </aside>
    </>
  )
}

export function DocsLayout({
  active,
  children,
  prose = true,
}: {
  active?: string
  children: React.ReactNode
  /** When false, children render raw in the main column (for pages that
   *  manage their own structure, e.g. the docs Overview and Install). */
  prose?: boolean
}) {
  return (
    <div className="shell shell-docs">
      <div className="grid items-start gap-10 py-10 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14 lg:py-14">
        <DocsSidebar active={active} />
        {prose ? (
          <article className="docs-prose min-w-0 max-w-prose">{children}</article>
        ) : (
          <div className="min-w-0">{children}</div>
        )}
      </div>
    </div>
  )
}
