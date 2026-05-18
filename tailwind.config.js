/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Warm cream palette (kept from Terralogix)
        warm: {
          50: "#F7F1E5",
          100: "#EDE3D2",
          200: "#E2D5BD",
          300: "#D9CDB8",
          400: "#C9B89C",
        },
        ink: {
          DEFAULT: "#15130F",
          muted: "#7A7368",
          subtle: "#B5AFA4",
        },
        // Saturated trade-status palette
        win:  { DEFAULT: "#1FB85C", light: "#83E6A8", dark: "#127A3D" },
        loss: { DEFAULT: "#E14A38", light: "#F2A395", dark: "#9C2A1D" },
        be:   { DEFAULT: "#F4B83A", light: "#F8D58A", dark: "#A87923" },
        // Side colors
        buy:  { DEFAULT: "#3B82E0", light: "#A4C1F2", dark: "#1F58B0" },
        sell: { DEFAULT: "#E89B5C", light: "#F2C698", dark: "#B36C30" },
        // Liquidity tier accents
        hod: "#7BA8D9",
        major: "#A86CD9",
      },
      backdropBlur: {
        glass: "24px",
      },
      boxShadow: {
        glass:
          "0 1px 0 rgba(255,255,255,0.85) inset, 0 16px 50px -16px rgba(31,29,26,0.22), 0 6px 18px -4px rgba(31,29,26,0.10)",
        card: "0 12px 36px -10px rgba(31,29,26,0.18), 0 3px 10px -2px rgba(31,29,26,0.07)",
        pop: "0 28px 80px -14px rgba(31,29,26,0.32)",
        glow: "0 0 0 1px rgba(255,255,255,0.6), 0 0 30px -8px rgba(31,29,26,0.4)",
        inner: "inset 0 1px 0 rgba(255,255,255,0.7)",
      },
      borderRadius: {
        "2.5xl": "20px",
        "3xl": "24px",
      },
      keyframes: {
        "ping-soft": {
          "0%": { transform: "scale(1)", opacity: "0.8" },
          "75%, 100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "ping-soft": "ping-soft 2.4s cubic-bezier(0,0,0.2,1) infinite",
        "fade-in": "fade-in 320ms cubic-bezier(0.2, 0, 0, 1) both",
        "slide-up": "slide-up 500ms cubic-bezier(0.2, 0, 0, 1) both",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};
