/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        // No serif any more: one clean sans everywhere reads more like a tool.
        serif: ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          900: "#0e0f11",
          700: "#3a3d43",
          500: "#6a6f78",
          300: "#b3b7be",
          100: "#e7e8eb",
          50: "#f4f5f6",
        },
        paper: "#ffffff",
        card: "#ffffff",
        wash: "#f9fafb",
      },
    },
  },
  plugins: [],
};
