import Link from "next/link"

/*
 * Docs sidebar — sticky on >= lg, becomes a collapsible <details>
 * panel on small screens so it doesn't push the actual doc content
 * down by a full page of TOC links.
 */
const sections = [
  {
    title: "Get started",
    items: [
      { href: "/docs/install/",      label: "Install" },
      { href: "/docs/quickstart/",   label: "Quick start" },
      { href: "/docs/configuration/", label: "Configuration" },
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
      { href: "/docs/cli/",         label: "CLI commands" },
      { href: "/docs/instances/",   label: "Instances" },
      { href: "/docs/sessions/",    label: "Sessions" },
      { href: "/docs/permissions/", label: "Permissions" },
      { href: "/docs/keybinds/",    label: "Keybinds" },
      { href: "/docs/api/",         label: "HTTP API" },
    ],
  },
  {
    title: "Extend",
    items: [
      { href: "/docs/mcp/",          label: "MCP servers" },
      { href: "/docs/plugins/",      label: "Plugins" },
      { href: "/docs/sdk/",          label: "TypeScript SDK" },
      { href: "/docs/self-hosting/", label: "Self-hosting" },
      { href: "/docs/themes/",       label: "Themes" },
    ],
  },
  {
    title: "Releases",
    items: [
      { href: "/docs/changelog/",    label: "Changelog" },
    ],
  },
] as const

function findCurrentLabel(active?: string): string | null {
  if (!active) return null
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href === active) return `${section.title} · ${item.label}`
    }
  }
  return null
}

function SidebarBody({ active }: { active?: string }) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.title} className="mb-6">
          <h5 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
            {section.title}
          </h5>
          <ul className="flex flex-col gap-1">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block py-1 transition-colors hover:text-ink ${
                    active === item.href ? "font-medium text-ink" : "text-ink-muted"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

export function DocsSidebar({ active }: { active?: string }) {
  const currentLabel = findCurrentLabel(active)
  return (
    <>
      {/*
       * Mobile/tablet (< lg): collapsed-by-default `<details>` so the
       * full TOC doesn't push doc content below the fold. Summary
       * shows the current page name; click to expand.
       */}
      <details className="group mb-6 border border-line bg-surface lg:hidden">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-ink-muted select-none hover:text-ink">
          <span>
            <span className="mr-2 inline-block w-3 text-ink-muted group-open:hidden">+</span>
            <span className="mr-2 inline-block w-3 text-ink-muted hidden group-open:inline-block">−</span>
            <span className="font-bold uppercase tracking-wider text-[11px] text-ink">Docs</span>
            {currentLabel ? (
              <span className="ml-2 text-ink-muted">{currentLabel}</span>
            ) : null}
          </span>
        </summary>
        <div className="px-4 pb-4 pt-1 text-sm">
          <SidebarBody active={active} />
        </div>
      </details>

      {/*
       * Desktop (>= lg): always-visible sticky sidebar.
       */}
      <aside className="hidden lg:block lg:sticky lg:top-20 text-sm self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
        <SidebarBody active={active} />
      </aside>
    </>
  )
}

export function DocsLayout({
  active,
  children,
}: {
  active?: string
  children: React.ReactNode
}) {
  return (
    <div className="container">
      <div className="grid items-start gap-6 py-8 lg:grid-cols-[260px_1fr] lg:gap-16 lg:py-12">
        <DocsSidebar active={active} />
        <article className="docs-prose max-w-prose min-w-0">{children}</article>
      </div>
    </div>
  )
}
