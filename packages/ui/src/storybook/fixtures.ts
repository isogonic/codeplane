export const diff = {
  before: {
    name: "src/greet.ts",
    contents: `export function greet(name: string) {
  return \`Hello, \${name}!\`
}
`,
  },
  after: {
    name: "src/greet.ts",
    contents: `export function greet(name: string, excited = false) {
  const message = \`Hello, \${name}!\`
  return excited ? \`\${message}!!\` : message
}
`,
  },
}

export const code = {
  name: "src/calc.ts",
  contents: `export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

export function average(values: number[]) {
  if (values.length === 0) return 0
  return sum(values) / values.length
}
`,
}

export const markdown = [
  "# Markdown",
  "",
  "Use **Markdown** for rich text.",
  "",
  "## Highlights",
  "- Headings, lists, and code blocks",
  "- Inline `code` and links",
  "",
  "```ts",
  "export const value = 42",
  "```",
  "",
  "## Tables",
  "",
  "| Region | Q1 | Q2 | Q3 |",
  "| --- | --: | --: | --: |",
  "| Americas | 124 | 142 | 158 |",
  "| EMEA | 88 | 102 | 117 |",
  "| APAC | 64 | 79 | 95 |",
  "",
  "## Math",
  "",
  "Inline: $E = mc^2$ — block:",
  "",
  "$$\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)$$",
  "",
  "## Mermaid",
  "",
  "```mermaid",
  "flowchart LR",
  "  markdown[Markdown] --> preview[Preview]",
  "  preview --> mermaid[Mermaid]",
  "```",
  "",
  "## Task Lists",
  "",
  "- [x] Render GitHub-flavored Markdown",
  "- [x] Keep fenced blocks as code",
  "- [ ] Review follow-up notes",
  "",
  "## Blockquotes",
  "",
  "> Plain markdown stays readable across web, desktop, and terminal surfaces.",
  "",
  "## Links and Files",
  "",
  "Open [the docs](https://example.com/docs) or inspect `packages/ui/src/components/markdown.tsx`.",
  "",
  "## JSON",
  "",
  "```json",
  JSON.stringify({
    name: "markdown",
    renderer: "plain",
    supports: ["headings", "tables", "code", "mermaid", "math"],
  }),
  "```",
  "",
  "## Shell",
  "",
  "```sh",
  "bun --cwd packages/ui typecheck",
  "```",
  "",
  "More at https://example.com/docs",
].join("\n")

export const changes = {
  additions: 18,
  deletions: 6,
}
