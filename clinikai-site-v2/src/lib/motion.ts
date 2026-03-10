export const motionTokens = {
  micro: 0.22,
  entry: 0.56,
  slowEntry: 0.7,
  easeOutCubic: [0.215, 0.61, 0.355, 1] as const,
  softSpring: {
    stiffness: 150,
    damping: 20,
    mass: 0.6,
  },
};

