import { ListFixture } from "./list"
import { DialogFixture } from "./dialog"
import { InputFixture } from "./input"
import { ScrollFixture } from "./scroll"
import { SpinnerFixture } from "./spinner"
import { ErrorBoundaryFixture } from "./error-boundary"

export { ListFixture, DialogFixture, InputFixture, ScrollFixture, SpinnerFixture, ErrorBoundaryFixture }

import type { JSX } from "@opentui/solid"

/** Registry of all named fixtures, used by dev/agent/preview CLIs. */
export const FIXTURES: Record<string, () => JSX.Element> = {
  list: () => <ListFixture />,
  dialog: () => <DialogFixture />,
  input: () => <InputFixture />,
  scroll: () => <ScrollFixture />,
  spinner: () => <SpinnerFixture />,
  "error-boundary": () => <ErrorBoundaryFixture />,
}

export type FixtureName = keyof typeof FIXTURES
