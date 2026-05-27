/* @refresh reload */
import "./styles/index.css"
import { ErrorBoundary } from "solid-js"
import { render } from "solid-js/web"
import { App } from "./app"

function ErrorFallback(err: Error, reset: () => void) {
  return (
    <div class="mobile-page" style={{ padding: "24px", "text-align": "center" }}>
      <h1 style={{ "font-size": "20px", "margin-bottom": "16px" }}>Something went wrong</h1>
      <p style={{ "font-size": "14px", "margin-bottom": "16px", opacity: "0.7" }}>{err.message}</p>
      <button onClick={reset} style={{ padding: "10px 20px", "border-radius": "8px" }}>
        Try again
      </button>
    </div>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Mobile app: missing #root element")
render(
  () => (
    <ErrorBoundary fallback={ErrorFallback}>
      <App />
    </ErrorBoundary>
  ),
  root,
)
