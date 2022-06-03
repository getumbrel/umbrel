<template>
  <div id="app">
    <!-- insert wallpaper in the root component since it's used across all views -->
    <div v-if="wallpaper" class="wallpaper"
      :class="wallpaperClassList"
      :style="{backgroundImage: `url('${env.VUE_APP_BACKEND_API_URL}/wallpapers/${wallpaper}')`}"
    ></div>
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
import { mapState } from "vuex";

export default {
  name: "App",
  data() {
    return {
      isIframe: window.self !== window.top,
      // For whatever reason, process.env is not accessible
      // Within the <template> tag, so binding it here...
      env: process.env
    };
  },
  computed: {
    ...mapState({
      wallpaper: state => state.user.wallpaper
    }),
    wallpaperClassList() {
      const classList = [];
      if (!window.CSS.supports('backdrop-filter', 'blur(0)')) {
        classList.push("wallpaper-no-backdrop-blur");
      }
      if (this.isIframe) {
        classList.push("wallpaper-blur", "wallpaper-slight-dim", "wallpaper-zoom-in");
        return classList;
      }
      if (this.$route.meta && this.$route.meta.wallpaperClass) {
        classList.push(this.$route.meta.wallpaperClass);
      }
      return classList;
    }
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
    // get wallpaper
    this.$store.dispatch("user/getWallpaper");
    this.$store.dispatch("apps/getBasicInfo");

    //for 100vh consistency
    this.updateViewPortHeightCSS();
    window.addEventListener("resize", this.updateViewPortHeightCSS);
  },
  beforeDestroy() {
    window.removeEventListener("resize", this.updateViewPortHeightCSS);
  }
};
</script>

<style lang="scss" scoped>
.wallpaper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: var(--vh100);
  z-index: -1;
  background-size: cover;
  background-position: center;
  will-change: transform;
  transition: background-image 0.3s, filter 1s, transform 1.5s ease;
  &:after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    backdrop-filter: blur(0);
    transition: backdrop-filter 0.4s ease;
  }
  &.wallpaper-blur {
    filter: blur(0);
    &:after {
      backdrop-filter: blur(10px);
    }
  }
  &.wallpaper-slight-dim {
    filter: brightness(0.9);
  }
  &.wallpaper-content-open {
    filter: brightness(var(--wallpaper-brightness));
  }
  &.wallpaper-zoom-in {
    transform: scale3d(1.25, 1.25, 1.25);
  }

  // use blur filter if backdrop blur isn't supported.
  // we check this via JS and not CSS @supports media query because
  // vue auto-prefixes backdrop-blur with -webkit vendor prefix
  // which tests positive for Safari, while we want this behavior off
  // for Safari due to artificacts on edges. that's the opposite of
  // Chrome, which has artificacts on edges using blur filter
  // but not backdrop-blur
  &.wallpaper-no-backdrop-blur {
    &:after {
      display: none !important;
    }
    &.wallpaper-blur {
      filter: blur(12px);
      &.wallpaper-slight-dim {
        filter: blur(12px) brightness(0.9);
      }
    }
  }
}
</style>