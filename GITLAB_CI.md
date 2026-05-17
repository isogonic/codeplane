# GitLab CI port

This repo's release pipelines were originally written as GitHub Actions in
`.github/workflows/*`. The `.gitlab-ci.yml` at the project root ports them
to GitLab CI with Linux-only runners. The GitHub workflows are kept in
place so an optional `git push --mirror` to GitHub keeps producing the
macOS + Windows + iOS builds the Linux-only GitLab pipeline can't.

## What's in `.gitlab-ci.yml`

Triggers: any tag matching `^v[0-9].*` pushed to GitLab.

| Tag shape           | npm publish | desktop release | mobile release |
| ------------------- | :---------: | :-------------: | :------------: |
| `v1.2.3`            |      ✓      |        ✓        |       ✓        |
| `v1.2.3-desktop`    |             |        ✓        |                |
| `v1.2.3-mobile`     |             |                 |       ✓        |

Stages, in order:

1. **`resolve`** — `resolve:tag` parses the tag, writes `resolved.env`, every
   downstream job consumes it via `needs: [{job, artifacts: true}]`.
2. **`release-create`** — `release-create:{desktop,mobile}` open the GitLab
   Releases up front (using `release-cli`). The release page exists before
   any build finishes, mirroring the "don't draft, create live" decision in
   the GitHub workflow.
3. **`build`** — `publish:npm` plus the platform builds: `build:desktop-linux`
   (AppImage + deb + tar.gz), `build:mobile-web-bundle` (Vite picker bundle),
   `build:mobile-android` (APK / AAB, with optional keystore signing).
4. **`release-publish`** — `release-publish:{desktop,mobile}` attach every
   built artefact to its release as an `--assets-link` so end users see one
   download page with everything. `when: always` so a single platform
   failure doesn't leave the release un-linked.

Assets are not stored directly in GitLab Releases (the API only links to
URLs). The build jobs upload to the project's **Generic Package Registry**
(`PUT $CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/generic/...`), and
the release links point at those package URLs.

## CI/CD variables to configure

Settings → CI/CD → Variables. Mark every secret as **Masked** and
**Protected** (so they only appear on protected tag pipelines). Mark
file-shaped values (the Android keystore) as **File** type.

| Variable                      | Required        | What it's for                                              |
| ----------------------------- | --------------- | ---------------------------------------------------------- |
| `NPM_TOKEN`                   | npm publish     | npm.com classic auth token (`automation` scope is enough)  |
| `ANDROID_KEYSTORE_BASE64`     | Android signing | `base64 -w0 release.keystore` — absent → debug-APK fallback |
| `ANDROID_KEYSTORE_PASSWORD`   | Android signing | Keystore password                                          |
| `ANDROID_KEY_ALIAS`           | Android signing | Signing key alias                                          |
| `ANDROID_KEY_PASSWORD`        | Android signing | Signing key password                                       |
| `GITLAB_TOKEN_PROJECT_RW`     | recommended     | Project access token (scope `api`) used by `release-cli` + curl. Without it, the jobs fall back to `CI_JOB_TOKEN`, which **cannot create releases on protected tags** in most GitLab projects — set this once and forget it. |

GitHub-secret → GitLab-variable mapping for the original workflows:

| Original GitHub secret             | GitLab variable               |
| ---------------------------------- | ----------------------------- |
| `secrets.NPM_TOKEN`                | `NPM_TOKEN`                   |
| `secrets.ANDROID_KEYSTORE_BASE64`  | `ANDROID_KEYSTORE_BASE64`     |
| `secrets.ANDROID_KEYSTORE_PASSWORD`| `ANDROID_KEYSTORE_PASSWORD`   |
| `secrets.ANDROID_KEY_ALIAS`        | `ANDROID_KEY_ALIAS`           |
| `secrets.ANDROID_KEY_PASSWORD`     | `ANDROID_KEY_PASSWORD`        |
| `secrets.GITHUB_TOKEN`             | `GITLAB_TOKEN_PROJECT_RW`     |
| `secrets.MAC_*` / `secrets.APPLE_*`| _(unused on Linux runners)_   |
| `secrets.IOS_*`                    | _(unused on Linux runners)_   |

## What's NOT covered (vs the GitHub workflows)

These jobs were dropped because no macOS / Windows runners are available
on GitLab — the original GitHub Actions cover them and stay the canonical
release path for those binaries:

- **macOS desktop** (`.dmg`, code signing, notarization, `latest-mac.yml`)
- **Windows desktop** (`.exe`, NSIS installer, `latest.yml`)
- **iOS mobile** (`.ipa` via `xcodebuild`, TestFlight upload)

The release notes banners on the GitLab Releases call out the Linux /
Android scope so end users know where to find the other platform builds.

## Re-introducing macOS / Windows later

Add two more `build:*` jobs alongside the Linux one — the rest of the
pipeline already handles arbitrary artefacts via the asset-link upload
pattern. Sketch:

```yaml
build:desktop-macos:
  <<: *tag-rule
  stage: build
  tags: [macos]            # <-- requires a runner with this tag
  needs: [resolve:tag, release-create:desktop]
  script:
    - bun install --frozen-lockfile
    - ( cd packages/desktop && bun run build )
    - ( cd packages/desktop && bunx electron-builder --mac dmg zip --x64 --arm64 --publish never )
    - # upload + append URLs to a desktop-mac-assets.txt
  artifacts:
    paths: [desktop-mac-assets.txt, packages/desktop/release/]
```

Then add `build:desktop-macos` to `release-publish:desktop`'s `needs:` and
extend its asset loop to read `desktop-mac-assets.txt` too.

## Mirror back to GitHub (optional, recommended)

If you want the existing macOS / Windows / iOS builds to keep running on
GitHub while GitLab is the source of truth, add a `git mirror` job. The
simplest version (commented-out skeleton — uncomment + set `GITHUB_REMOTE`):

```yaml
mirror:github:
  stage: .post
  image: alpine:3.20
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    - if: '$CI_COMMIT_TAG'
  before_script:
    - apk add --no-cache git openssh-client
  script:
    - git remote add github "$GITHUB_REMOTE"
    - git push --mirror github
```

Set `GITHUB_REMOTE` to a URL with a fine-grained PAT, e.g.
`https://oauth2:<token>@github.com/<user>/<repo>.git`.
