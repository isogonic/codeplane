const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://codeplane.ai" : `https://${stage}.codeplane.ai`,
  console: stage === "production" ? "https://codeplane.ai/auth" : `https://${stage}.codeplane.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/devinoldenburg/codeplane",
  discord: "https://codeplane.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
