import { createContext, useContext, type ParentProps, type ValidComponent } from "solid-js"
import { createSimpleContext } from "./helper"

const ctx = createSimpleContext<ValidComponent, { component: ValidComponent }>({
  name: "FileComponent",
  init: (props) => props.component,
})

export const FileComponentProvider = ctx.provider
export const useFileComponent = ctx.use

export type FileReferenceSelection = {
  startLine: number
  endLine?: number
}

type FileReferenceContext = {
  open?: (path: string, selection?: FileReferenceSelection) => void
}

const reference = createContext<FileReferenceContext>({})

export function FileReferenceProvider(props: ParentProps<FileReferenceContext>) {
  return <reference.Provider value={{ open: props.open }}>{props.children}</reference.Provider>
}

export function useFileReference() {
  return useContext(reference)
}
