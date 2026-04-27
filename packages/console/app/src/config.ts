/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://codeplane.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/devinoldenburg/codeplane",
    starsFormatted: {
      compact: "140K",
      full: "140,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/codeplane",
    discord: "https://discord.gg/codeplane",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "850",
    commits: "11,000",
    monthlyUsers: "6.5M",
  },
} as const
