// @ts-nocheck
import { createEffect, onMount } from "solid-js"
import { Dialog } from "./dialog"
import { Button } from "./button"
import { Icon } from "./icon"
import { Markdown } from "./markdown"
import { useDialog } from "../context/dialog"

const docs = `### Overview
Visual reference for the post-update "What's new" dialog rendered by the app. Mirrors packages/app/src/components/dialog-whats-new.tsx with hardcoded copy so the dialog primitive, markdown styling, and footer layout can be checked in isolation.
`

const SAMPLE_NOTES = {
  tag: "v27.0.5",
  body: `## Fixes

- **Session titles:** Sessions were getting stuck on the default "New session" because the title generator silently swallowed every failure and had no fallback path. The generator now (1) logs every failure path instead of swallowing them, (2) captures \`reasoning-delta\` events alongside \`text-delta\` so reasoning-only emissions still contribute, (3) strips \`<think>\` blocks and surrounding quotes, (4) retries the stream up to 3 times when the result is empty, (5) catches errors from \`agents.get\` / \`provider.getModel\` / \`toModelMessagesEffect\` with \`Effect.catch\` so the fork always reaches the fallback, and (6) falls back to a 60-char slice of the first user message when the LLM produces nothing usable — sessions are never permanently stuck on "New session" again.

## What's new

- Native SSH tool with five operations (\`exec\`, \`script\`, \`upload\`, \`download\`, \`sync\`) and OpenSSH ControlMaster reuse.
- Smarter "What's new" dialog after every release.
`,
  url: "https://github.com/devinoldenburg/codeplane/releases/tag/v27.0.5",
  publishedAt: "2026-05-01T13:35:02Z",
}

function WhatsNewPreview(props: { previousVersion?: string; published?: string | null; body?: string }) {
  const dialog = useDialog()
  const version = SAMPLE_NOTES.tag.replace(/^v/, "")
  const body = props.body ?? SAMPLE_NOTES.body
  const published = props.published === undefined ? SAMPLE_NOTES.publishedAt : props.published

  return (
    <Dialog
      size="large"
      transition
      title={
        <div class="flex items-center gap-3 -my-1">
          <span
            data-component="whats-new-icon"
            class="flex size-8 items-center justify-center rounded-full bg-surface-interactive-base text-text-on-interactive shadow-sm ring-1 ring-inset ring-border-interactive-base/40"
          >
            <Icon name="sparkle" size="small" />
          </span>
          <span class="flex flex-col leading-tight gap-0.5">
            <span class="text-16-medium text-text-strong">What's new in Codeplane {version}</span>
            <span class="text-12-regular text-text-weak inline-flex items-center gap-2">
              {props.previousVersion ? (
                <span class="inline-flex items-center gap-1.5">
                  <span class="rounded bg-surface-raised-base px-1.5 py-0.5 font-mono text-11-regular text-text-base">
                    v{props.previousVersion}
                  </span>
                  <Icon name="arrow-right" size="x-small" class="text-icon-weak" />
                  <span class="rounded bg-surface-interactive-base-subtle px-1.5 py-0.5 font-mono text-11-regular text-text-interactive">
                    v{version}
                  </span>
                </span>
              ) : published ? (
                <span>
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(published))}
                </span>
              ) : null}
            </span>
          </span>
        </div>
      }
    >
      <div data-component="whats-new" class="flex h-full min-h-0 flex-col">
        <div data-component="whats-new-divider" class="shrink-0 border-t border-border-weak-base" />

        <div data-component="whats-new-body" class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {body ? (
            <Markdown text={body} class="whats-new-markdown" />
          ) : (
            <div class="flex h-full items-center justify-center px-6 text-center text-13-regular text-text-weak">
              No release notes available for this version.
            </div>
          )}
        </div>

        <div
          data-component="whats-new-footer"
          class="flex shrink-0 items-center justify-between gap-3 border-t border-border-weak-base px-6 py-3"
        >
          {SAMPLE_NOTES.url ? (
            <a
              href={SAMPLE_NOTES.url}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-13-medium text-text-interactive hover:underline"
            >
              <span>View full release on GitHub</span>
              <Icon name="square-arrow-top-right" size="x-small" />
            </a>
          ) : (
            <span />
          )}
          <Button type="button" variant="primary" size="small" onClick={() => dialog.close()}>
            Got it
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export default {
  title: "App/WhatsNewDialog",
  id: "components-whats-new-dialog",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: docs } },
  },
}

export const Default = {
  render: () => {
    const dialog = useDialog()
    const open = () => dialog.show(() => <WhatsNewPreview previousVersion="27.0.4" />)
    onMount(open)
    createEffect(() => {
      // Keep the dialog visible across HMR reloads while iterating on the
      // design — if the active dialog disappears we re-open it.
      if (!dialog.active) open()
    })
    return (
      <Button variant="secondary" onClick={open}>
        Open dialog
      </Button>
    )
  },
}

export const FreshInstall = {
  render: () => {
    const dialog = useDialog()
    const open = () => dialog.show(() => <WhatsNewPreview />)
    onMount(open)
    return (
      <Button variant="secondary" onClick={open}>
        Open (no previous version)
      </Button>
    )
  },
}

export const Empty = {
  render: () => {
    const dialog = useDialog()
    const open = () => dialog.show(() => <WhatsNewPreview previousVersion="27.0.4" body="" />)
    onMount(open)
    return (
      <Button variant="secondary" onClick={open}>
        Open (no notes)
      </Button>
    )
  },
}
