---
model: codeplane/gpt-5.4
---

Create `UPCOMING_CHANGELOG.md` from the structured changelog input below.
If `UPCOMING_CHANGELOG.md` already exists, ignore its current contents completely.
Do not preserve, merge, or reuse text from the existing file.

The input already contains the exact commit range since the last non-draft release.
The commits are already filtered to the release-relevant packages and grouped into
the release sections. Do not fetch GitHub releases, PRs, or build your own commit list.
The input may also include a `## Community Contributors Input` section.

Before writing any entry you keep, inspect the real diff with
`git show --stat --format='' <hash>` or `git show --format='' <hash>` so you can
understand the actual code changes and not just the commit message (they may be misleading).
Do not use `git log` or author metadata when deciding attribution.

Rules:

- Write the final file with sections in this order:
  `## Core`, `## Web App`, `## SDK`, `## Extensions`
- Only include sections that have at least one notable entry
- Keep one bullet per commit you keep
- Skip commits that are entirely internal, CI, tests, refactors, or otherwise not user-facing
- Every bullet must name the exact affected surface first: a command, screen, setting, platform build, API, SDK surface, or shipped behavior
- Every bullet must state the exact user-visible outcome or fix, not just that work happened
- Start each bullet with a capital letter
- Prefer what changed for users over what code changed internally
- If a commit only looks internal but fixes a shipped bug, explain the user-visible fix explicitly
- Do not copy raw commit prefixes like `fix:` or `feat:` or trailing PR numbers like `(#123)`
- Community attribution is deterministic: only preserve an existing `(@username)` suffix from the changelog input
- If an input bullet has no `(@username)` suffix, do not add one
- Never add a new `(@username)` suffix from `git show`, commit authors, names, or email addresses
- Do not write filler like `Various fixes`, `Stability improvements`, `Rolls forward in-flight work`, `Bumps version metadata`, or `Internal cleanup`
- Do not add install/update/platform explainer banners like `CLI · npm release`, `Desktop Shell`, or `Mobile Shell`
- If no precise user-facing entries remain, write exactly `BLOCKED: no precise user-facing release notes could be derived from this range.`
- If the input contains `## Community Contributors Input`, append the block below that heading to the end of the final file verbatim
- Do not add, remove, rewrite, or reorder contributor names or commit titles in that block
- Do not derive the thank-you section from the main summary bullets
- Do not include the heading `## Community Contributors Input` in the final file
- Focus on writing the least words to get your point across - users will skim read the changelog, so we should be precise

**Importantly, the changelog is for users (who are at least slightly technical), they may use the Web App, CLI, SDK, Plugins and so forth. Be thorough in understanding flow-on effects that may not be immediately apparent. A package upgrade may patch a real bug. A refactor may fix a race. But the final note must still say exactly what shipped behavior changed.**

<changelog_input>

!`bun script/raw-changelog.ts $ARGUMENTS`

</changelog_input>
