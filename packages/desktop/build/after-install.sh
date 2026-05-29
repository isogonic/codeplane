#!/bin/bash
# Recreate the `codeplane` command symlink. Kept here (idempotent) so this
# script is correct whether electron-builder appends it to or replaces its
# generated postinst.
if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/codeplane' ] && [ -e '/usr/bin/codeplane' ] && [ "$(readlink '/usr/bin/codeplane')" != '/etc/alternatives/codeplane' ]; then
        rm -f '/usr/bin/codeplane'
    fi
    update-alternatives --install '/usr/bin/codeplane' 'codeplane' '/opt/Codeplane/codeplane' 100 || ln -sf '/opt/Codeplane/codeplane' '/usr/bin/codeplane'
else
    ln -sf '/opt/Codeplane/codeplane' '/usr/bin/codeplane'
fi

# Force Electron's setuid sandbox helper on, unconditionally. electron-builder's
# default postinst only setuids chrome-sandbox when unprivileged user namespaces
# look unavailable at install time — but Ubuntu 24.04+ lets the `unshare` probe
# succeed while AppArmor blocks the userns at runtime, so the namespace sandbox
# fails and the app aborts with "The SUID sandbox helper binary ... is not
# configured correctly." A setuid-root helper always works and keeps the
# Chromium sandbox enabled.
sandbox='/opt/Codeplane/chrome-sandbox'
if [ -f "$sandbox" ]; then
    chown root:root "$sandbox" || true
    chmod 4755 "$sandbox" || true
fi
