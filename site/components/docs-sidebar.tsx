import Link from "next/link"

/*
 * Docs sidebar — sticky on >= lg, becomes a scrollable TOC on small
 * screens. The `active` prop highlights the current page so the user
 * always sees where they are in the tree.
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
] as const

export function DocsSidebar({ active }: { active?: string }) {
  return (
    <aside className="lg:sticky lg:top-20 text-sm self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
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
    </aside>
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
      <div className="grid items-start gap-12 py-12 lg:grid-cols-[260px_1fr] lg:gap-16">
        <DocsSidebar active={active} />
        <article className="docs-prose max-w-prose min-w-0">{children}</article>
      </div>
    </div>
  )
}
