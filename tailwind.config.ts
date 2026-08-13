import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

/**
 * Design tokens ported 1:1 from docs/fuel-ui-prototype.html.
 * Do not change values here without updating the prototype spec.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F6F7F9",
        card: "#FFFFFF",
        sidebar: "#0F172A",
        text: "#0F172A",
        muted: "#475569",
        primary: "#0F766E",
        petrol: "#15803D",
        diesel: "#D97706",
        kerosene: "#2563EB",
        danger: "#DC2626",
        warning: "#F59E0B",
        info: "#2563EB",
        success: "#16A34A",
        border: "#E2E8F0",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15, 23, 42, 0.08)",
        panel: "0 4px 18px rgba(15, 23, 42, 0.06)",
      },
      borderRadius: {
        xl2: "20px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};

export default config;
