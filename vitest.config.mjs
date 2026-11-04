import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { obsidian: new URL("./test/mocks/obsidian.js", import.meta.url).pathname } },
  // jsdom provides window, so window.setTimeout works in tests as in Obsidian.
  test: { environment: "jsdom", include: ["test/**/*.test.js"] },
});
