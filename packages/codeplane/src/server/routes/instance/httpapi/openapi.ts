import { CodeplaneVersion } from "@codeplane-ai/shared/version"
import { OpenApi } from "effect/unstable/httpapi"

export const ExperimentalInstanceHttpApiAnnotations = OpenApi.annotations({
  title: "codeplane experimental HttpApi",
  version: CodeplaneVersion,
  description: "Experimental HttpApi surface for selected instance routes.",
})

export const InstanceHttpApiAnnotations = OpenApi.annotations({
  title: "codeplane HttpApi",
  version: CodeplaneVersion,
  description: "Effect HttpApi surface for instance routes.",
})
