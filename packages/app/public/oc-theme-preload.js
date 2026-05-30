;(function () {
  var key = "codeplane-theme-id"
  var themeId = localStorage.getItem(key) || "oc-2"

  if (themeId === "oc-1") {
    themeId = "oc-2"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("codeplane-theme-css-light")
    localStorage.removeItem("codeplane-theme-css-dark")
  }

  // Only light and dark are supported. Any other stored value (including the
  // legacy "system" auto-follow) falls back to the default dark scheme.
  var scheme = localStorage.getItem("codeplane-color-scheme")
  var mode = scheme === "light" ? "light" : "dark"
  var isDark = mode === "dark"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  if (themeId === "oc-2") return

  var css = localStorage.getItem("codeplane-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
