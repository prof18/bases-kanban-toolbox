import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
export default [
  { ignores: ["main.js", "node_modules/", "coverage/", "plan/"] },
  ...obsidianmd.configs.recommended,
  { files: ["src/**/*.js"], languageOptions: { sourceType: "module", globals: { ...globals.browser } } },
  { files: ["test/**/*.js", "*.mjs", "scripts/**/*.mjs"], languageOptions: { sourceType: "module", globals: { ...globals.node } } },
];
