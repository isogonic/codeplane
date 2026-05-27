import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createEffect, createSignal } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface ImagePreviewProps {
  src: string
  alt?: string
}

export function ImagePreview(props: ImagePreviewProps) {
  const i18n = useI18n()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal(false)

  createEffect(() => {
    props.src
    setLoading(true)
    setError(false)
  })

  return (
    <div data-component="image-preview">
      <div data-slot="image-preview-container">
        <Kobalte.Content data-slot="image-preview-content">
          <div data-slot="image-preview-header">
            <Kobalte.CloseButton
              data-slot="image-preview-close"
              as={IconButton}
              icon="close"
              variant="ghost"
              aria-label={i18n.t("ui.common.close")}
            />
          </div>
          <div data-slot="image-preview-body">
            {loading() && !error() && (
              <div data-slot="image-preview-placeholder" aria-busy="true">
                {i18n.t("ui.imagePreview.loading")}
              </div>
            )}
            {error() && (
              <div data-slot="image-preview-error" role="alert">
                {i18n.t("ui.imagePreview.error")}
              </div>
            )}
            <img
              src={props.src}
              alt={props.alt ?? i18n.t("ui.imagePreview.alt")}
              data-slot="image-preview-image"
              style={{ display: loading() || error() ? "none" : "" }}
              onLoad={() => {
                setLoading(false)
                setError(false)
              }}
              onError={() => {
                setLoading(false)
                setError(true)
              }}
            />
          </div>
        </Kobalte.Content>
      </div>
    </div>
  )
}
