import { base64Encode } from "@codeplane-ai/shared/util/encode"

export const notificationHref = (item: { directory?: string; session?: string }) => {
  if (!item.directory) return
  const slug = base64Encode(item.directory)
  if (item.session && item.session !== "global") return `/${slug}/session/${item.session}`
  return `/${slug}`
}
