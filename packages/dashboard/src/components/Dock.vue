<template>
  <div>

    <transition :name="position === 'left' ? 'dock-left-transition' : 'dock-bottom-transition'" appear>

      <div :class="{'dock-left-container': position === 'left', 'dock-left-container-open': showDock}" class="dock-container w-auto d-flex justify-content-center">
        <div v-if="position === 'left'">
          <div class="align-items-center cursor-pointer d-flex dock-left-open-button justify-content-center" @click="toggleDock">
            <svg width="8" height="19" viewBox="0 0 8 19" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1.78613L6.55082 9.19549C6.81706 9.55087 6.81706 10.0393 6.55082 10.3946L1 17.804" stroke="white" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
        </div>

        <div class="dock d-flex justify-content-center align-items-center">
          <router-link :to="{name: 'home'}">
            <dock-app id="home" name="Home" :position="position" :active="this.$route.name === 'home'" @click="toggleDock(350)" />
          </router-link>

          <router-link :to="{name: 'app-store'}">
            <dock-app id="app-store" name="App Store" :position="position" :notifications="appStoreNotifications" :active="this.$route.name === 'app-store' || this.$route.name === 'app-store-app'" @click="toggleDock(350)" />
          </router-link>

          <router-link :to="{name: 'settings'}">
            <dock-app id="settings" name="Settings" :position="position" :notifications="settingsNotifications" :active="this.$route.name === 'settings'" @click="toggleDock(350)" />
          </router-link>

          <dock-app id="mode" :name="darkMode ? 'Light Mode' : 'Dark Mode'" :position="position" @click="toggleDarkMode">
            <template v-slot:icon>
              <svg width="100%" height="100%" viewBox="0 0 70 70" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                  <g filter="url(#filter0_i_255_16699)">
                    <transition name="dark-light-mode-gradient-transition">
                      <rect v-if="darkMode" width="70" height="70" rx="19.1406" fill="url(#paint0_linear_255_16699)"/>
                    </transition>
                    <transition name="dark-light-mode-gradient-transition">
                      <rect v-if="!darkMode" width="70" height="70" rx="19.14" fill="url(#paint1_linear_255_16699)"/>
                    </transition>
                  </g>
                  <transition name="dark-light-mode-transition" mode="out-in">
                    <rect v-if="darkMode" x="8.5" y="11.2998" width="53" height="53" fill="url(#pattern0)"/>
                  </transition>
                  <transition name="dark-light-mode-transition" mode="out-in">
                    <rect v-if="!darkMode" x="11" y="15" width="44" height="47" fill="url(#pattern1)"/>
                  </transition>
                  <defs>
                  <filter id="filter0_i_255_16699" x="0" y="-2" width="70" height="72" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                  <feFlood flood-opacity="0" result="BackgroundImageFix"/>
                  <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
                  <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                  <feOffset dy="-2"/>
                  <feGaussianBlur stdDeviation="2"/>
                  <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
                  <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
                  <feBlend mode="normal" in2="shape" result="effect1_innerShadow_255_16699"/>
                  </filter>
                  <filter id="filter1_i_255_16699" x="0" y="-2" width="70" height="72" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                  <feFlood flood-opacity="0" result="BackgroundImageFix"/>
                  <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
                  <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                  <feOffset dy="-2"/>
                  <feGaussianBlur stdDeviation="2"/>
                  <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
                  <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
                  <feBlend mode="normal" in2="shape" result="effect1_innerShadow_255_16699"/>
                  </filter>
                  <pattern id="pattern0" patternContentUnits="objectBoundingBox" width="1" height="1">
                  <use xlink:href="#image0_255_16699" transform="scale(0.00130208)"/>
                  </pattern>
                  <pattern id="pattern1" patternContentUnits="objectBoundingBox" width="1" height="1">
                  <use xlink:href="#image1_255_16699" transform="translate(-0.0155138) scale(0.00154809)"/>
                  </pattern>
                  <linearGradient id="paint0_linear_255_16699" x1="35" y1="0" x2="35" y2="70" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#F3B766"/>
                  <stop offset="1" stop-color="#DE484A"/>
                  </linearGradient>
                  <linearGradient id="paint1_linear_255_16699" x1="35" y1="0" x2="35" y2="70" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#C26FFA"/>
                  <stop offset="1" stop-color="#6B36C6"/>
                  </linearGradient>
                  <image id="image0_255_16699" width="768" height="768" xlink:href="@/assets/dock/sun.png"/>
                  <image id="image1_255_16699" width="666" height="690" xlink:href="@/assets/dock/moon.png"/>
                  </defs>
              </svg>
            </template>
          </dock-app>

          <dock-app id="logout" name="Logout" :position="position" @click="logout" />
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import { mapState } from "vuex";
import delay from "@/helpers/delay";
import DockApp from "@/components/DockApp";

export default {
  data() {
    return {
      showDock: false
    };
  },
  computed: {
    ...mapState({
      darkMode: state => state.system.darkMode
    })
  },
  props: {
    position: {
      type: String,
      default: 'bottom' // can be left (for mobile) or bottom (for desktop)
    },
    appStoreNotifications: {
      type: Number,
      default: 0
    },
    settingsNotifications: {
      type: Number,
      default: 0
    }
  },
  methods: {
    logout() {
      if (window.confirm('Are you sure you want to log out?')) {
        this.$store.dispatch("user/logout");
      }
    },
    toggleDarkMode() {
      this.$store.dispatch("system/toggleDarkMode");
    },
    async toggleDock(delayMs = 0) {
      // use delay = 350ms so the hide dock transition 
      // to left perfectly aligns with vertical 
      // app icon bounce on mobile devices
      await delay(delayMs);
      this.showDock = !this.showDock;
    }
  },
  components: {
    DockApp,
  }
};
</script>

<style lang="scss" scoped>
.dock-left-close-background {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: var(--vh100);
  overflow: hidden;
  z-index: 997;
}
.dock-container {
  position: fixed;
  bottom: 10px;
  left: 50%;
  border-radius: 16px;
  transform: translate3d(-50%, 0, 0);
  z-index: 998;
  .dock {
    padding: 11px 7px;
    height: 100%;
    border-radius: 16px;
    background-color: var(--dock-background-color);
    border: 1px solid var(--dock-border-color);
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(20px) saturate(180%);
  }
}

.dock-container.dock-left-container {
  position: fixed;
  top: 50%;
  left: 0;
  bottom: auto;
  transform: translate3d(-100%, -50%, 0);
  border-radius: 0 16px 16px 0;
  transition: transform 0.3s ease;

  .dock-left-open-button {
    position: absolute;
    top: 50%;
    right: -28px;
    transform: translate3d(0, -50%, 0);
    height: 70px;
    width: 30px;
    border-radius: 0 7px 7px 0;
    background-color: var(--dock-background-color);
    border: 1px solid var(--dock-border-color);
    border-left: none;
    backdrop-filter: blur(20px) saturate(180%);
    box-shadow: 4px 0 6px rgb(0 0 0 / 5%);
    transition: transform 0.3s ease;
    svg {
      transition: transform 0.3s ease;
      path {
        stroke: var(--dock-left-open-button-icon-color);
        stroke-width: 3px;
      }
    }
  }
  &.dock-left-container-open {
    transform: translate3d(0, -50%, 0);
    .dock-left-open-button {
      svg {
        transform: scale3d(-1, 1, 1);
      }
    }
  }
  .dock {
    flex-direction: column !important;
    padding: 7px 11px 7px 13px;
    border-radius: 0 16px 16px 0;
  }
}

.dark-light-mode-transition-enter-active,
.dark-light-mode-transition-leave-active {
  transition: transform 0.5s ease;
}
.dark-light-mode-transition-enter {
  transform: translate3d(0, 200%, 0);
}
.dark-light-mode-transition-enter-to {
  transform: translate3d(0, 0, 0);
}
.dark-light-mode-transition-leave {
  transform: translate3d(0, 0, 0);
}
.dark-light-mode-transition-leave-to {
  transform: translate3d(0, -200%, 0);
}

.dark-light-mode-gradient-transition-enter-active,
.dark-light-mode-gradient-transition-leave-active {
  transition: opacity 0.3s ease;
}
.dark-light-mode-gradient-transition-enter {
  opacity: 0.5;
}
.dark-light-mode-gradient-transition-enter-to {
  opacity: 1;
}
.dark-light-mode-gradient-transition-leave {
  opacity: 1;
}
.dark-light-mode-gradient-transition-leave-to {
  opacity: 0.5;
}

// Dock enter/leave transition
.dock-bottom-transition-enter-active,
.dock-bottom-transition-leave-active {
  transition: transform 1s, opacity 0.6s ease;
}
.dock-bottom-transition-enter {
  transform: translate3d(-50%, 100%, 0);
  opacity: 0;
}
.dock-bottom-transition-enter-to {
  transform: translate3d(-50%, 0, 0);
  opacity: 1;
}
.dock-bottom-transition-leave {
  transform: translate3d(-50%, 0, 0);
  opacity: 1;
}
.dock-bottom-transition-leave-to {
  transform: translate3d(-50%, 100%, 0);
  opacity: 0;
}

// Dock enter/leave transition
.dock-left-container.dock-left-transition-enter-active {
  animation: dock-left-peek 1s;
  animation-delay: 1.2s;
  .dock-left-open-button {
    opacity: 0;
    transform: translate3d(-100%, -50%, 0);
  }
}

@keyframes dock-left-peek {
  0% {
    transform: translate3d(-100%, -50%, 0) scale3d(0.85, 0.85, 0.85);
  }
  42% {
    transform: translate3d(0, -50%, 0) scale3d(1, 1, 1);
  }
  58% {
    transform: translate3d(0, -50%, 0) scale3d(1, 1, 1);
  }
  100% {
    transform: translate3d(-100%, -50%, 0) scale3d(0.85, 0.85, 0.85);
  }
}
</style>