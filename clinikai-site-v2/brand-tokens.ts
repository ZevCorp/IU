export const brandTokens = {
  name: "ClinikAI",
  colors: {
    background: "#FFFFFF",
    text: "#0B0F14",
    brandBlue: "#4DA3FF",
    uiGray: "#E9EEF5",
    accent: "#22D3C5",
  },
  typography: {
    heading: {
      family: "Manrope",
      weights: [600, 700, 800],
    },
    body: {
      family: "Inter",
      weights: [400, 500, 600],
    },
  },
  spacing: {
    sectionYMobile: "4.5rem",
    sectionYDesktop: "6.5rem",
    containerMax: "76rem",
    gridColumns: 12,
  },
  radius: {
    button: "999px",
    card: "18px",
  },
  motion: {
    microMs: 220,
    entryMs: 560,
    easing: "cubic-bezier(0.215, 0.61, 0.355, 1)",
    spring: {
      stiffness: 150,
      damping: 20,
      mass: 0.6,
    },
  },
} as const;

export type BrandTokens = typeof brandTokens;

