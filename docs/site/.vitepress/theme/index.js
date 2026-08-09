import DefaultTheme from "vitepress/theme";

import { installThemeAccessibility } from "./accessibility.js";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    installThemeAccessibility(router);
  },
};
