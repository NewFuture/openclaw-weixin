import DefaultTheme from "vitepress/theme";
import { h } from "vue";

import { installThemeAccessibility } from "./accessibility.js";
import HomeFooter from "./HomeFooter.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "layout-bottom": () => h(HomeFooter),
    }),
  enhanceApp({ router }) {
    installThemeAccessibility(router);
  },
};
