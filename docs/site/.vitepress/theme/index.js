import DefaultTheme from "vitepress/theme";
import { h } from "vue";

import { installThemeAccessibility } from "./accessibility.js";
import HomeTools from "./HomeTools.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "layout-bottom": () => h(HomeTools),
    }),
  enhanceApp({ router }) {
    installThemeAccessibility(router);
  },
};
