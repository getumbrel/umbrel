<template>
  <div id="app">
    <transition name="loading" mode>
      <div v-if="isIframe">
        <div class="d-flex flex-column align-items-center justify-content-center min-vh100 p-2">
          <img alt="Umbrel" src="@/assets/logo.svg" class="mb-5 logo" />
          <span class="text-muted w-75 text-center">
            <small>For security reasons Umbrel cannot be embedded in an iframe.</small>
          </span>
        </div>
      </div>
      <router-view v-else></router-view>
    </transition>
  </div>
</template>

<style lang="scss">
@import "@/global-styles/design-system.scss";
</style>

<script>
export default {
  name: "App",
  data() {
    return {
      isIframe: window.self !== window.top
    };
  },
  methods: {
    //TODO: move this to the specific layout that needs this 100vh fix
    updateViewPortHeightCSS() {
      return document.documentElement.style.setProperty(
        "--vh100",
        `${window.innerHeight}px`
      );
    }
  },
  created() {
    //for 100vh consistency
    this.updateViewPortHeightCSS();
    window.addEventListener("resize", this.updateViewPortHeightCSS);
  },
  beforeDestroy() {
    window.removeEventListener("resize", this.updateViewPortHeightCSS);
  }
};
</script>
