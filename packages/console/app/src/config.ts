/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://github.com/devinoldenburg/codeplane",

  // GitHub
  github: {
    repoUrl: "https://github.com/devinoldenburg/codeplane",
    starsFormatted: {
      compact: "140K",
      full: "140,000",
    },
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "850",
    commits: "11,000",
    monthlyUsers: "6.5M",
  },
} as const
