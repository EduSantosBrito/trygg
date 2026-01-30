import { defineConfig } from "vite";
import { trygg } from "trygg/vite-plugin";
import tryggConfig from "./trygg.config";

export default defineConfig({
  plugins: [trygg(tryggConfig)],
});
