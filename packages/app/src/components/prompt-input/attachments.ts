import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { showToast } from "@codeplane-ai/ui/toast"
import { usePrompt, type ContentPart, type ImageAttachmentPart } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"
import { attachmentMime } from "./files"
import { normalizePaste, pasteMode } from "./paste"

// Reject oversized attachments before reading them: dataUrl() slurps the whole
// file into memory and base64-encodes it (~33% larger), so a large dragged/
// pasted file would spike memory and freeze the tab. Matches the server-side
// read-tool attachment cap.
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024

function dataUrl(file: File, mime: string) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => resolve(""))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      const idx = value.indexOf(",")
      if (idx === -1) {
        resolve(value)
        return
      }
      resolve(`data:${mime};base64,${value.slice(idx + 1)}`)
    })
    reader.readAsDataURL(file)
  })
}

type PromptAttachmentsInput = {
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const prompt = usePrompt()
  const language = useLanguage()

  const warn = () => {
    showToast({
      title: language.t("prompt.toast.pasteUnsupported.title"),
      description: language.t("prompt.toast.pasteUnsupported.description"),
    })
  }

  const add = async (file: File, toast = true) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      if (toast) warn()
      return false
    }

    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) warn()
      return false
    }

    const editor = input.editor()
    if (!editor) return false

    const url = await dataUrl(file, mime)
    if (!url) return false

    const attachment: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: file.name,
      mime,
      dataUrl: url,
    }
    const cursor = prompt.cursor() ?? getCursorPosition(editor)
    prompt.set([...prompt.current(), attachment], cursor)
    return true
  }

  const addAttachment = (file: File) => add(file)

  const addAttachments = async (files: File[], toast = true) => {
    let found = false

    for (const file of files) {
      const ok = await add(file, false)
      if (ok) found = true
    }

    if (!found && files.length > 0 && toast) warn()
    return found
  }

  const removeAttachment = (id: string) => {
    const current = prompt.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  /**
   * Capture a screenshot of the user's selected screen / window / tab via the
   * Screen Capture API and attach it to the prompt as a PNG. Picks the very
   * first frame from the granted MediaStream, draws it to a canvas, and
   * uploads the result through the existing add() pipeline.
   *
   * Returns true if a frame was captured + attached. Returns false (and
   * shows a toast) if the API isn't available, the user cancelled the
   * picker, or the capture failed.
   */
  const captureScreenshot = async (): Promise<boolean> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.screenshotUnsupported.title"),
        description: language.t("prompt.toast.screenshotUnsupported.description"),
      })
      return false
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" } as MediaTrackConstraints,
        audio: false,
      })
    } catch (err) {
      // User cancelled the picker; that's not an error worth a toast.
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) {
        return false
      }
      showToast({
        variant: "error",
        title: language.t("prompt.toast.screenshotFailed.title"),
        description: language.t("prompt.toast.screenshotFailed.description"),
      })
      return false
    }

    try {
      const track = stream.getVideoTracks()[0]
      if (!track) throw new Error("no video track")

      // Prefer ImageCapture if the browser has it (Chromium); fall back to
      // <video> + <canvas> on Safari/Firefox where ImageCapture isn't there.
      let blob: Blob | null = null
      const ImageCaptureCtor = (globalThis as { ImageCapture?: new (track: MediaStreamTrack) => unknown })
        .ImageCapture
      if (ImageCaptureCtor) {
        try {
          const capture = new ImageCaptureCtor(track) as { grabFrame(): Promise<ImageBitmap> }
          const bitmap = await capture.grabFrame()
          const canvas = document.createElement("canvas")
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const ctx = canvas.getContext("2d")
          if (!ctx) throw new Error("no 2d context")
          ctx.drawImage(bitmap, 0, 0)
          bitmap.close?.()
          blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
        } catch {
          // fall through to <video> path
        }
      }
      if (!blob) {
        blob = await new Promise<Blob | null>((resolve, reject) => {
          const video = document.createElement("video")
          video.muted = true
          video.playsInline = true
          video.srcObject = stream
          video.onloadedmetadata = () => {
            video
              .play()
              .then(() => {
                const canvas = document.createElement("canvas")
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                const ctx = canvas.getContext("2d")
                if (!ctx) {
                  reject(new Error("no 2d context"))
                  return
                }
                ctx.drawImage(video, 0, 0)
                canvas.toBlob(resolve, "image/png")
              })
              .catch(reject)
          }
          video.onerror = () => reject(new Error("video error"))
        })
      }

      if (!blob) throw new Error("no blob")

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19)
      const file = new File([blob], `screenshot-${stamp}.png`, { type: "image/png" })
      return await add(file)
    } catch {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.screenshotFailed.title"),
        description: language.t("prompt.toast.screenshotFailed.description"),
      })
      return false
    } finally {
      for (const track of stream.getTracks()) track.stop()
    }
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })

    if (files.length > 0) {
      await addAttachments(files)
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    // Browser clipboard has no images and no text, try the host clipboard for images.
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file) {
        await addAttachment(file)
        return
      }
    }

    if (!plainText) return

    const text = normalizePaste(plainText)

    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }

    if (pasteMode(text) === "manual") {
      put()
      return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (inserted) return

    put()
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      input.setDraggingType("image")
    } else if (hasText) {
      input.setDraggingType("@mention")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    input.setDraggingType(null)

    const plainText = event.dataTransfer?.getData("text/plain")
    const filePrefix = "file:"
    if (plainText?.startsWith(filePrefix)) {
      const filePath = plainText.slice(filePrefix.length)
      input.focusEditor()
      input.addPart({ type: "file", path: filePath, content: "@" + filePath, start: 0, end: 0 })
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    await addAttachments(Array.from(dropped))
  }

  onMount(() => {
    makeEventListener(document, "dragover", handleGlobalDragOver)
    makeEventListener(document, "dragleave", handleGlobalDragLeave)
    makeEventListener(document, "drop", handleGlobalDrop)
  })

  return {
    addAttachment,
    addAttachments,
    removeAttachment,
    handlePaste,
    captureScreenshot,
  }
}
