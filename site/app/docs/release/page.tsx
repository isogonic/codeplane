import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Release process",
  description: "How Codeplane releases are prepared, validated, committed, tagged, published to npm, packaged for desktop/mobile, and deployed to codeplane.cc.",
  alternates: { canonical: "/docs/release/" },
  openGraph: {
    title: "Release process · Codeplane",
    description: "How Codeplane releases are prepared, validated, committed, tagged, published to npm, packaged for desktop/mobile, and deployed to codeplane.cc.",
    url: "/docs/release/",
    type: "article",
  },
  twitter: {
    title: "Release process · Codeplane",
    description: "How Codeplane releases are prepared, validated, committed, tagged, published to npm, packaged for desktop/mobile, and deployed to codeplane.cc.",
    card: "summary_large_image",
  },
}

export default function ReleaseProcess() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/release/">
        <h1>Release process</h1>
        <p className="lede">
          A Codeplane release is a version bump on <code>main</code> plus a GitHub release tag.
          The tag fans out into npm, desktop, and mobile workflows. The website deploy is a
          separate Pages build triggered by changes under <code>site/</code> or the mirrored static
          files under <code>docs/</code>.
        </p>

        <h2>Version source of truth</h2>
        <p>
          Edit <code>packages/shared/src/version.ts</code>, then run <code>bun run version:sync</code>.
          The sync script updates package versions across workspaces and the website package.
        </p>
        <pre><code>{`export const CodeplaneVersion = "28.18.0"

bun run version:sync`}</code></pre>

        <h2>Pre-release checklist</h2>
        <ol>
          <li>Start clean: <code>git status --short --branch</code>.</li>
          <li>Fetch both remotes and tags.</li>
          <li>Review <code>HEAD..remote/main</code> before pushing.</li>
          <li>Make source changes and regenerate any checked-in outputs.</li>
          <li>Run site validation if docs or website changed.</li>
          <li>Run repo validation: typecheck, lint, focused tests, build smoke.</li>
          <li>Bump version and run <code>bun run version:sync</code>.</li>
          <li>Regenerate SDK artifacts if the release flow or OpenAPI changed.</li>
          <li>Commit as <code>Release vX.Y.Z</code>.</li>
          <li>Push <code>main</code> to the publishing remotes.</li>
          <li>Create GitHub release <code>vX.Y.Z</code>.</li>
        </ol>

        <h2>Validation commands</h2>
        <pre><code>{`bun --cwd site typecheck
bun --cwd site build
bun turbo typecheck
bun lint
bun --cwd packages/codeplane test test/config/config.test.ts test/tool/git.test.ts
bun --cwd packages/codeplane script/build.ts --skip-embed-web-ui --skip-install --single`}</code></pre>
        <p>
          Root tests intentionally fail with a guard. Run package tests from package directories,
          and use focused tests for the area changed.
        </p>

        <h2>GitHub release</h2>
        <pre><code>{`gh release create vX.Y.Z \\
  --repo devinoldenburg/codeplane \\
  --target main \\
  --title "vX.Y.Z" \\
  --notes "$(cat <<'EOF'
## Highlights

Codeplane **vX.Y.Z** ...

## Validation

- ...
EOF
)"`}</code></pre>
        <p>
          Creating the base release tag starts the release workflows. Do not create the
          <code>-desktop</code> or <code>-mobile</code> tags by hand for a normal release.
        </p>

        <h2>Workflow outputs</h2>
        <table>
          <thead><tr><th>Workflow</th><th>Trigger</th><th>Output</th></tr></thead>
          <tbody>
            <tr><td><code>npm-release</code></td><td><code>v*</code> base tag</td><td><code>codeplane-ai</code>, SDK, plugin, platform runtime packages on npm.</td></tr>
            <tr><td><code>desktop-release</code></td><td><code>v*</code> base tag</td><td><code>vX.Y.Z-desktop</code> release with macOS, Windows, Linux installers.</td></tr>
            <tr><td><code>mobile-release</code></td><td><code>v*</code> base tag</td><td><code>vX.Y.Z-mobile</code> release with iOS/Android artifacts.</td></tr>
            <tr><td><code>pages</code></td><td><code>site/**</code>, workflow, or mirrored docs files</td><td>Static <code>codeplane.cc</code> deployment.</td></tr>
          </tbody>
        </table>

        <h2>After creating the release</h2>
        <pre><code>{`gh run list --repo devinoldenburg/codeplane --workflow=npm-release --limit 4
gh run list --repo devinoldenburg/codeplane --workflow=desktop-release --limit 4
gh run list --repo devinoldenburg/codeplane --workflow=mobile-release --limit 4
gh release view vX.Y.Z --repo devinoldenburg/codeplane
npm view codeplane-ai@X.Y.Z version`}</code></pre>
        <p>
          When npm succeeds, smoke install into a temporary prefix and run the installed binary from
          <code>node_modules/.bin/codeplane</code>. That path is the reliable one for prefix
          installs.
        </p>

        <h2>Failure playbook</h2>
        <table>
          <thead><tr><th>Failure</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td>Push rejected</td><td><code>git fetch</code>, rebase, resolve version files by keeping the intended release bump, rerun validation.</td></tr>
            <tr><td>npm workflow fails before publish</td><td>Fix source, bump to a new patch/minor, create a new release tag. Do not retag a public release.</td></tr>
            <tr><td>Desktop matrix partially fails</td><td>Inspect the failed platform job; successful artifacts may still be attached to the paired release.</td></tr>
            <tr><td>Pages deploy does not change live site</td><td>Check Pages source mode and the latest <code>pages</code> workflow. Legacy branch mode serves <code>/docs</code>.</td></tr>
            <tr><td>Smoke install cannot find binary</td><td>Run <code>node_modules/.bin/codeplane --version</code> inside the temp prefix.</td></tr>
          </tbody>
        </table>

        <p>
          User-facing changes belong in <Link href="/docs/changelog/">Changelog</Link>. Release
          mechanics and repo internals live here.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
