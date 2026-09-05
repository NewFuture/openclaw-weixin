<script>
import { useData, withBase } from "vitepress";
import { computed } from "vue";

import { localeById } from "../docs.mjs";

export default {
  setup() {
    const { frontmatter, isDark, lang, theme } = useData();
    const isChinese = computed(() => lang.value.startsWith("zh"));
    const otherLocale = computed(() => localeById(isChinese.value ? "en" : "zh"));

    return { frontmatter, isDark, isChinese, otherLocale, theme, withBase };
  },
};
</script>

<template>
  <footer v-if="frontmatter.layout === 'home'" class="home-footer">
    <p v-if="theme.footer?.message" v-html="theme.footer.message"></p>
    <p v-if="theme.footer?.copyright" v-html="theme.footer.copyright"></p>
    <div class="home-tools">
      <a :href="withBase(otherLocale.prefix)" :lang="otherLocale.lang" :hreflang="otherLocale.lang">
        {{ otherLocale.label }}
      </a>
      <button type="button" :aria-pressed="isDark" @click="isDark = !isDark">
        <span class="vpi-moon" aria-hidden="true" />
        {{ isChinese ? "深色模式" : "Dark mode" }}
      </button>
    </div>
  </footer>
</template>
