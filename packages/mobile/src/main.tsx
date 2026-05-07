/* @refresh reload */
import "./styles/index.css"
import { render } from "solid-js/web"
import { App } from "./app"

const root = document.getElementById("root")
if (!root) throw new Error("Mobile app: missing #root element")
render(() => <App />, root)
