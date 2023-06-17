<template>
  <!-- Desktop app drawer -->
  <div v-if="!isMobileDevice" id="desktop-app-drawer" class="d-flex flex-grow-1 justify-content-center align-items-center mt-2 mt-sm-0">
    <div class="apps-carousel flex-grow-1 d-flex flex-column justify-content-sm-center align-items-center">
      <b-carousel
        id="carousel-1"
        :v-model="0"
        :interval="0"
        :controls="!isTouchDevice && appSlides.length > 1"
        :indicators="appSlides.length > 1"
        no-wrap
      >
        <b-carousel-slide
          img-blank
          v-for="(slide, index) in appSlides"
          :key="index"
        >
          <div class="d-flex justify-content-center align-items-center">
            <div class="d-flex flex-wrap justify-content-start align-content-start apps-container mt-2" :class="{'apps-container-with-controls': !isTouchDevice}">
              <installed-app
                v-for="app in slide"
                :key="app.id"
                :app="app"
                :showUninstallButton="isUninstalling"
                :isUninstalling="uninstallingApps.includes(app.id)"
              >
              </installed-app>
            </div>
          </div>
        </b-carousel-slide>
      </b-carousel>
      <b-button 
        size="sm" 
        pill
        class="text-uppercase mt-4 font-weight-bold px-3 btn-glass"
        @click="toggleUninstallButtons"
      >{{ isUninstalling ? 'Done' : 'Manage apps'}}</b-button>
    </div>
  </div>

  <!-- Mobile app drawer -->
  <div v-else>
    <div class="w-100 mt-3 mb-4 d-flex justify-content-center">
      <b-button 
        size="sm" 
        pill
        class="text-uppercase font-weight-bold px-3 btn-glass"
        @click="toggleUninstallButtons"
      >{{ isUninstalling ? 'Done' : 'Manage apps'}}</b-button>
    </div>
     <div class="my-3 pb-2 d-flex justify-content-center align-items-center">
      <div class="d-flex flex-wrap justify-content-start align-content-start mobile-apps-container">
        <installed-app
          v-for="app in installedApps"
          :key="app.id"
          :app="app"
          :showUninstallButton="isUninstalling"
          :isUninstalling="uninstallingApps.includes(app.id)"
        >
        </installed-app>
      </div>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

import delay from "@/helpers/delay";

import InstalledApp from "@/components/InstalledApp";

export default {
  props: {
    isTouchDevice: Boolean,
    isMobileDevice: Boolean
  },
  data() {
    return {
      appSlides: [],
      isUninstalling: false,
    };
  },
  computed: {
    ...mapState({
      installedApps: (state) => state.apps.installed,
      uninstallingApps: (state) => state.apps.uninstalling
    }),
  },
  methods: {
    toggleUninstallButtons() {
      this.isUninstalling = !this.isUninstalling;
    },
    createAppSlidesArray(arr, size) {
      if (arr.length > size) {
        return [arr.slice(0, size), ...this.createAppSlidesArray(arr.slice(size), size)]
      }
      return [arr];
    },
    async untilElementExists(selector) {
      while (document.querySelector(selector) === null) {
        await delay(10);
      }
    },
    async setAppSlides() {
      await this.untilElementExists("#desktop-app-drawer");
      // Full width on iPad/tablets, else full width minus arrow buttons width + padding
      let drawerWidth = this.isTouchDevice ? document.getElementById("desktop-app-drawer").clientWidth : document.getElementById("desktop-app-drawer").clientWidth - 260;
      let drawerHeight = document.getElementById("desktop-app-drawer").clientHeight - 50;

      let appWidth = 140;
      let appHeight = 140;

      // Max 21 apps per slide
      const maxColumns = 7;
      const maxRows = 3;

      // Calculate apps that we can fit in a symmetrical grid
      const columns = Math.min(parseInt(drawerWidth / appWidth), maxColumns);
      const rows = Math.min(parseInt(drawerHeight / appHeight), maxRows);

      const appsPerSlide = columns * rows;
      const appSlides = this.createAppSlidesArray(this.installedApps, appsPerSlide);

      this.appSlides = appSlides;

      // Update CSS variables
      document.documentElement.style.setProperty(
        "--apps-container-width",
        `${appWidth * columns}px`
      );
      document.documentElement.style.setProperty(
        "--apps-container-height",
        `${appHeight * rows}px`
      );
    }
  },
  async created() {
    // Create desktop app drawer 
    if (!this.isMobileDevice) {
      await this.setAppSlides();

      // Set height of last slide equal to the first slide's height (to make sure all slides are equal height)
      await this.untilElementExists(".carousel-item");
      const slides = document.getElementsByClassName("carousel-item");
      if (slides.length) {
        slides[slides.length - 1].style.height = `${slides[0].offsetHeight}px`;
      }

      // Re-create app drawer on window resize
      window.addEventListener("resize", this.setAppSlides);
    } 
    
    // Create mobile app drawer
    if (this.isMobileDevice) {
      let deviceWidth = window.innerWidth;
      let minimumAppWidth = 110;
      let columns = parseInt(deviceWidth / minimumAppWidth);
      let appWidth = (deviceWidth / columns);
      document.documentElement.style.setProperty('--app-width', `${appWidth}px`);
    }
  },
  destroyed() {
    window.removeEventListener("resize", this.setAppSlides);
  },
  components: {
    InstalledApp,
  },
  watch: {
    installedApps() {
      // Re-create app drawer on app installs/uninstalls
      if (!this.isMobileDevice) {
        this.setAppSlides();
      }
    }
  },
};
</script>

<style lang="scss" scoped>
.apps-container {
  width: var(--apps-container-width);
  height: var(--apps-container-height);
  &.apps-container-with-controls {
    margin-left: 0;
    margin-right: 0;
  }
}

.apps-carousel {
  .carousel {
    width: 100%;
    max-width: calc(var(--apps-container-width));
    transform: translateZ(0);
  }
}

.mobile-apps-container {
  justify-content: space-evenly;
}
</style>
