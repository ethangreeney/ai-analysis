/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          900: "#0a0a0a",
          700: "#3a3a3a",
          500: "#6b6b6b",
          300: "#bcbcbc",
          100: "#ececec",
          50: "#f6f6f6",
        },
      },
    },
  },
  plugins: [],
};
