<script>
import { useData, withBase } from "vitepress";
import { computed } from "vue";

import { localeById } from "../docs.mjs";

export default {
  setup() {
    const { frontmatter, isDark, lang } = useData();
    const isChinese = computed(() => lang.value.startsWith("zh"));
    const otherLocale = computed(() => localeById(isChinese.value ? "en" : "zh"));

    return { frontmatter, isDark, isChinese, otherLocale, withBase };
  },
};
</script>

<template>
  <div v-if="frontmatter.layout === 'home'" class="home-tools">
    <a :href="withBase(otherLocale.prefix)" :lang="otherLocale.lang" :hreflang="otherLocale.lang">
      {{ otherLocale.label }}
    </a>
    <button type="button" :aria-pressed="isDark" @click="isDark = !isDark">
      <span class="vpi-moon" aria-hidden="true" />
      {{ isChinese ? "深色模式" : "Dark mode" }}
    </button>
  </div>
</template>
