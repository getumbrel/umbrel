<template>
  <div class="position-relative" :class="{'mobile-view': isMobileDevice}" >

    <!-- Wallpaper menu toggle button -->
    <transition name="wallpaper-menu-toggle-button-transition">
      <div v-if="isOnHome && isNotScrolling">
        <wallpaper-menu-toggle-button @toggle="toggleWallpaperMenu" />
      </div>
    </transition>

    <!-- Wallpaper menu -->
    <transition name="wallpaper-menu-transition">
      <wallpaper-menu v-if="showWallpaperMenu" @close="toggleWallpaperMenu" />
    </transition>

    <!-- Wallpaper menu background overlay to close menu on click -->
    <div v-if="showWallpaperMenu" class="wallpaper-close-background" @click="toggleWallpaperMenu"></div>

    <!-- Home content -->
    <div class="home-container d-flex flex-column" v-on:scroll.passive="onScroll">
      <div class="mt-3 mt-sm-3 mb-2">
        <div class="d-flex flex-column justify-content-center align-items-center">
          <logo class="umbrel-logo mb-2" compact />
          <span class="text-greeting text-white text-lowercase text-center d-block mb-4">{{ greeting }}, {{ name.split(" ")[0] }}</span>
          
          <!-- Umbrel update notification -->
          <transition name="notification-transition" appear>
            <notification v-if="availableUpdate.version" :text="`Umbrel ${availableUpdate.version} is now available`">
              <b-button @click.prevent="confirmUpdate" variant="alert-glass" size="sm" class="px-2 px-sm-3 mr-2 mr-sm-3" pill>View</b-button>
            </notification>
          </transition>

          <!-- Low RAM notification -->
          <transition name="notification-transition" appear>
            <notification v-if="isRunningLowOnRam" text="Your Umbrel is running low on RAM">
              <router-link to="/settings#ram" class="btn btn-sm btn-alert-glass rounded-pill px-3 mr-2 mr-sm-3" pill>View</router-link>
            </notification>
          </transition>

          <!-- Low storage notification -->
          <transition name="notification-transition" appear>
            <notification v-if="isRunningLowOnStorage" text="Your Umbrel is running low on storage">
              <router-link to="/settings#storage" class="btn btn-sm btn-alert-glass rounded-pill px-3 mr-2 mr-sm-3" pill>View</router-link>
            </notification>
          </transition>

          <!-- High CPU temperature -->
          <transition name="notification-transition" appear>
            <notification v-if="isRunningHot" text="Your Raspberry Pi's temperature is too hot">
              <router-link to="/settings#temperature" class="btn btn-sm btn-alert-glass rounded-pill px-3 mr-2 mr-sm-3" pill>View</router-link>
            </notification>
          </transition>

        </div>
      </div>

      <!-- Show suggested apps if no apps are installed  -->
      <transition name="app-drawer-transition" appear>
        <app-suggestions v-if="appStore.length && noAppsInstalled && isOnHome" />
      </transition>

      <!-- App drawer -->
      <transition name="app-drawer-transition" appear>
        <app-drawer v-if="installedApps.length && isOnHome" :isTouchDevice="isTouchDevice" :isMobileDevice="isMobileDevice" />
      </transition>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

import WallpaperMenuToggleButton from '@/views/Home/WallpaperMenuToggleButton.vue';
import WallpaperMenu from '@/views/Home/WallpaperMenu.vue';
import Notification from '@/views/Home/Notification.vue';
import AppDrawer from '@/views/Home/AppDrawer.vue';
import AppSuggestions from '@/views/Home/AppSuggestions.vue';
import Logo from '@/components/Logo.vue';

export default {
  data() {
    return {
      showWallpaperMenu: false,
      isNotScrolling: true
    };
  },
  props: {
    isOnHome: Boolean,
    isMobileDevice: Boolean,
    isTouchDevice: Boolean,
    isRunningLowOnRam: Boolean,
    isRunningLowOnStorage: Boolean,
    isRunningHot: Boolean
  },
  computed: {
    ...mapState({
      name: state => state.user.name,
      noAppsInstalled: state => state.apps.noAppsInstalled,
      installedApps: (state) => state.apps.installed,
      appStore: state => state.apps.store,
      availableUpdate: state => state.system.availableUpdate,
      ram: (state) => state.system.ram,
      storage: (state) => state.system.storage,
      cpuTemperature: (state) => state.system.cpuTemperature,
    }),
    greeting: () => {
      const currentHour = new Date().getHours();

      const greetingMessage =
        currentHour >= 4 && currentHour < 12 // after 4:00AM and before 12:00PM
          ? "Good morning"
          : currentHour >= 12 && currentHour <= 16 // after 12:00PM and before 4:00PM
          ? "Good afternoon"
          : currentHour > 16 || currentHour < 4 // after 4:00PM or before 4:00AM (to accommodate our fellow hackers)
          ? "Good evening"
          : "Welcome back"; // if for some reason the calculation didn't work

      return greetingMessage;
    },
  },
  methods: {
    onScroll({ target: { scrollTop }}) {
      if (scrollTop < 40) {
        this.isNotScrolling = true;
      } else {
        this.isNotScrolling = false;
      }
    },
    toggleWallpaperMenu() {
      this.showWallpaperMenu = !this.showWallpaperMenu;
    },
    confirmUpdate() {
      this.$store.dispatch("system/confirmUpdate");
    },
  },
  components: {
    WallpaperMenuToggleButton,
    WallpaperMenu,
    Notification,
    AppDrawer,
    AppSuggestions,
    Logo,
  }
};
</script>

<style lang="scss" scoped>
.home-container {
  height: calc(var(--vh100) - 126px);
}
.mobile-view {
  .home-container {
    height: var(--vh100);
    overflow-y: auto;
  }
}
.text-greeting {
  font-size: 3.5rem;
  font-weight: 700;
  line-height: 1;
  text-shadow: 1px 1px 3px rgb(0 0 0 / 10%);
}
.umbrel-logo {
  width: 100%;
  max-width: 120px;
}

.wallpaper-close-background {
  position: fixed;
  content: "";
  top: 0;
  right: 0;
  width: 100%;
  height: 100%;
  z-index: 999;
}

.wallpaper-menu-toggle-button-transition-enter-active,
.wallpaper-menu-toggle-button-transition-leave-active {
  transition: opacity 0.2s linear;
}
.wallpaper-menu-toggle-button-transition-enter {
  opacity: 0;
}
.wallpaper-menu-toggle-button-transition-enter-to {
  opacity: 1;
}
.wallpaper-menu-toggle-button-transition-leave {
  opacity: 1;
}
.wallpaper-menu-toggle-button-transition-leave-to {
  opacity: 0;
}

.app-drawer-transition-enter-active,
.app-drawer-transition-leave-active {
  transition: transform 1s, opacity 0.6s ease;
}
.app-drawer-transition-enter {
  transform: scale3d(0.9, 0.9, 0.9);
  opacity: 0;
}
.app-drawer-transition-enter-to {
  transform: scale3d(1, 1, 1);
  opacity: 1;
}
.app-drawer-transition-leave {
  transform: scale3d(1, 1, 1);
  opacity: 1;
}
.app-drawer-transition-leave-to {
  transform: scale3d(0.9, 0.9, 0.9);
  opacity: 0;
}

.notification-transition-enter-active,
.notification-transition-leave-active {
  transition: transform 0.4s, opacity 0.4s ease;
}
.notification-transition-enter {
  transform: scale3d(0.7, 0.7, 0.7);
  opacity: 0;
}
.notification-transition-enter-to {
  transform: scale3d(1, 1, 1);
  opacity: 1;
}
.notification-transition-leave {
  transform: scale3d(1, 1, 1);
  opacity: 1;
}
.notification-transition-leave-to {
  transform: scale3d(0.7, 0.7, 0.7);
  opacity: 0;
}
</style>
