# codeplane.cc GitHub Pages source

This directory is intended to be served by GitHub Pages from the `main` branch
using the `/docs` source. It contains the files needed for the public
`https://codeplane.cc` site:

- `CNAME` sets the Pages custom domain to `codeplane.cc`.
- `index.html` is the public home page.
- `install` mirrors the shell installer endpoint used by `curl -fsSL https://codeplane.cc/install | bash`.
- `config.json` and `tui.json` provide schema endpoints referenced by Codeplane.
- `docs/index.html` provides the `/docs` route used by in-product links.
- `assets/` contains the public logo assets.

## GitHub Pages setup

In the repository settings:

1. Open **Settings -> Pages**.
2. Set **Build and deployment** to **Deploy from a branch**.
3. Select branch `main` and folder `/docs`.
4. Set the custom domain to `codeplane.cc`.
5. Enable **Enforce HTTPS** after DNS checks pass.

## DNS

Point the apex domain `codeplane.cc` at GitHub Pages using GitHub's current
custom-domain documentation:

- `A` records for `codeplane.cc`:
  - `185.199.108.153`
  - `185.199.109.153`
  - `185.199.110.153`
  - `185.199.111.153`
- `AAAA` records for `codeplane.cc`:
  - `2606:50c0:8000::153`
  - `2606:50c0:8001::153`
  - `2606:50c0:8002::153`
  - `2606:50c0:8003::153`
- Optional `CNAME` record for `www.codeplane.cc` to the repository owner's
  GitHub Pages host, for example `devinoldenburg.github.io`.

Use GitHub's official custom-domain guide as the source of truth for DNS
values: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

## Codeplane co-author identity

The app can add this trailer when the setting is enabled:

```text
Co-Authored-By: Codeplane <noreply@codeplane.cc>
```

For GitHub to show a Codeplane avatar/profile, create or configure the GitHub
account that owns the `noreply@codeplane.cc` email address, verify the email,
and set that account's profile image to the Codeplane logo.
