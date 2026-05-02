# Versioning

Codeplane public releases use semantic versions:

```text
MAJOR.MINOR.PATCH
```

Versions are not derived from dates, build time, commit count, or branch age.

## Release Line

The semantic release line starts at `27.0.0`.

Earlier public builds used calendar-like versions such as `26.5.44`. The `27.0.0` floor keeps every new semantic release greater than those legacy versions, so existing installations can update normally through npm, Bun, pnpm, Homebrew, Scoop, Chocolatey, curl installs, and self-hosted upgrade scripts.

## Bumps

- `PATCH` is for compatible fixes, tool behavior improvements, and low-risk polish.
- `MINOR` is for new user-facing capabilities, new API fields, or compatible workflow changes.
- `MAJOR` is for breaking CLI/API/config/storage behavior or a required migration step.

## Channels

- `latest` receives stable semantic versions such as `27.0.1`.
- Preview channels use semantic prereleases from the current base version plus the channel and commit suffix, for example `27.0.1-feature-name.abc1234`.
- Explicit release overrides may use `v` prefixes, but the stored version is normalized without `v`.

## Legacy Compatibility

Upgrade and update checks must keep accepting old tags and installed versions.

- `v26.5.44` and `26.5.44` are treated as the same installed version.
- Old calendar-style versions compare lower than `27.0.0` and newer.
- Exact old versions remain valid input for manual upgrade commands and release tooling.
- Update checks should compare normalized semantic versions, not raw strings.
