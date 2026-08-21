/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Fraunces"', "Georgia", "ui-serif", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          900: "#161512",
          700: "#403d38",
          500: "#6f6b63",
          300: "#b5b1a8",
          100: "#e8e5de",
          50: "#f2f0eb",
        },
        paper: "#f7f5f0",
        card: "#fffefc",
      },
    },
  },
  plugins: [],
};
