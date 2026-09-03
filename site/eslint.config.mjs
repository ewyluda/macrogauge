// Flat config (todo #30): Next's core-web-vitals rules plus jsx-a11y so the
// sortable-header / expandable-row regressions (#28, #29) cannot recur
// silently. `npm run lint` runs in CI's site job.
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["out/**", ".next/**", "node_modules/**", "public/**", "next-env.d.ts"] },
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "@next/next": nextPlugin, "jsx-a11y": jsxA11y, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...jsxA11y.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // every table header that sorts must be a real button (#28); every
      // expandable row must expose its control as a button (#29)
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "error",
      "jsx-a11y/click-events-have-key-events": "error",
    },
  },
];
