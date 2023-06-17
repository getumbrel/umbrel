<template>
  <div class="installed-app d-flex flex-column align-items-center">
    <a
      :href="url"
      target="_blank"
      class="d-block mb-1 mb-sm-2 installed-app-link"
      :class="isUninstalling ? 'cursor-wait' : ''"
      :disabled="isUninstalling"
      v-on:click="openApp($event)"
      >
      <div class="installed-app-icon-container">
        <img
          class="installed-app-icon app-icon"
          :class="{'d-none': !iconLoaded, 'dim-in-out': isUninstalling || isOffline}"
          :alt="app.name"
          :src="app.icon"
          draggable="false"
          @load="onIconLoad"
        />
        <svg
          :class="isUninstalling || isOffline ? 'background-dim-in-out' : ''"
          class="installed-app-icon-frame" width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"
        >
          <mask id="mask0_311_6906" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="white"/>
          </mask>
          <g mask="url(#mask0_311_6906)">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M100.354 0.353591L93.2071 7.50004H100V8.50004H92.5V32.5H100V33.5H92.5V66.5H100V67.5H92.5V91.5H100V92.5H93.2071L100.354 99.6465L99.6465 100.354L92.5 93.2071V100H91.5V92.5H67.5V100H66.5V92.5H33.5V100H32.5V92.5H8.50004V100H7.50004V93.2071L0.353591 100.354L-0.353516 99.6465L6.79293 92.5H3.77595e-05V91.5H7.50004V67.5H3.77595e-05V66.5H7.50004V33.5H3.77595e-05V32.5H7.50004V8.50004H3.77595e-05V7.50004H6.79293L-0.353516 0.353591L0.353591 -0.353516L7.50004 6.79293V3.77595e-05H8.50004V7.50004H32.5V3.77595e-05H33.5V7.50004H66.5V3.77595e-05H67.5V7.50004H91.5V3.77595e-05H92.5V6.79293L99.6465 -0.353516L100.354 0.353591ZM8.50004 9.20714V32.5H11.8083C13.8334 28.0878 16.6006 24.0869 19.9501 20.6572L8.50004 9.20714ZM20.6572 19.9501L9.20714 8.50004H32.5V11.8083C28.0878 13.8334 24.0869 16.6006 20.6572 19.9501ZM20.6572 21.3644C17.497 24.6022 14.8681 28.3611 12.9117 32.5H31.7929L20.6572 21.3644ZM32.5 31.7929L21.3644 20.6572C24.6022 17.497 28.3611 14.8681 32.5 12.9117V31.7929ZM33.5 34.2071V45.8908C34.2141 43.014 35.6609 40.4265 37.6308 38.3379L33.5 34.2071ZM38.3379 37.6308L34.2071 33.5H45.8908C43.014 34.2141 40.4265 35.6609 38.3379 37.6308ZM38.3383 39.0454C35.6481 41.9081 34 45.7616 34 50C34 54.2385 35.6481 58.092 38.3383 60.9547L49.2929 50L38.3383 39.0454ZM50 49.2929L39.0454 38.3383C41.9081 35.6481 45.7616 34 50 34C54.2385 34 58.092 35.6481 60.9547 38.3383L50 49.2929ZM50 50.7071L39.0454 61.6618C41.9081 64.352 45.7616 66 50 66C54.2385 66 58.092 64.352 60.9547 61.6618L50 50.7071ZM61.6618 60.9547L50.7071 50L61.6618 39.0454C64.352 41.9081 66 45.7616 66 50C66 54.2385 64.352 58.092 61.6618 60.9547ZM61.6621 62.3692C59.5735 64.3392 56.9861 65.7859 54.1093 66.5H65.7929L61.6621 62.3692ZM66.5 65.7929L62.3692 61.6621C64.3392 59.5735 65.7859 56.9861 66.5 54.1093V65.7929ZM67.5 68.2071V87.0883C71.639 85.1319 75.3979 82.5031 78.6357 79.3428L67.5 68.2071ZM79.3428 78.6357L68.2071 67.5H87.0883C85.1319 71.639 82.5031 75.3979 79.3428 78.6357ZM79.3429 80.05C75.9132 83.3995 71.9123 86.1667 67.5 88.1917V91.5H90.7929L79.3429 80.05ZM91.5 90.7929L80.05 79.3429C83.3995 75.9132 86.1667 71.9123 88.1917 67.5H91.5V90.7929ZM67.5 8.50004H90.7929L79.3429 19.9501C75.9132 16.6006 71.9123 13.8334 67.5 11.8083V8.50004ZM91.5 9.20714L80.05 20.6572C83.3995 24.0869 86.1667 28.0878 88.1917 32.5H91.5V9.20714ZM67.5 12.9117C71.639 14.8681 75.3979 17.497 78.6357 20.6572L67.5 31.7929V12.9117ZM79.3428 21.3644L68.2071 32.5H87.0883C85.1319 28.3611 82.5031 24.6022 79.3428 21.3644ZM54.1093 33.5H65.7929L61.6621 37.6308C59.5735 35.6609 56.9861 34.2141 54.1093 33.5ZM66.5 34.2071L62.3692 38.3379C64.3392 40.4265 65.7859 43.014 66.5 45.8908V34.2071ZM33.5 54.1093C34.2141 56.9861 35.6609 59.5735 37.6308 61.6621L33.5 65.7929V54.1093ZM38.3379 62.3692L34.2071 66.5H45.8908C43.014 65.7859 40.4265 64.3392 38.3379 62.3692ZM12.9117 67.5H31.7929L20.6572 78.6357C17.497 75.3979 14.8681 71.639 12.9117 67.5ZM32.5 68.2071L21.3644 79.3428C24.6022 82.5031 28.3611 85.1319 32.5 87.0883V68.2071ZM11.8083 67.5C13.8334 71.9123 16.6006 75.9132 19.9501 79.3429L8.50004 90.7929V67.5H11.8083ZM20.6572 80.05L9.20714 91.5H32.5V88.1917C28.0878 86.1667 24.0869 83.3995 20.6572 80.05ZM88.6349 33.5H91.5V43.4996C90.9571 40.0053 89.9834 36.6534 88.6349 33.5ZM66.5 11.3651V8.50004H56.5005C59.9948 9.04296 63.3467 10.0167 66.5 11.3651ZM43.4996 8.50004H33.5V11.3651C36.6534 10.0167 40.0053 9.04296 43.4996 8.50004ZM33.5 12.4554C38.5486 10.2335 44.1302 9.00004 50 9.00004C55.8698 9.00004 61.4515 10.2335 66.5 12.4554V31.218C62.0975 27.3473 56.3229 25 50 25C43.6772 25 37.9026 27.3473 33.5 31.218V12.4554ZM11.3651 33.5H8.50004V43.4996C9.04296 40.0053 10.0167 36.6534 11.3651 33.5ZM8.50004 56.5005V66.5H11.3651C10.0167 63.3467 9.04296 59.9948 8.50004 56.5005ZM12.4554 66.5C10.2335 61.4515 9.00004 55.8698 9.00004 50C9.00004 44.1302 10.2335 38.5486 12.4554 33.5H31.218C27.3473 37.9026 25 43.6772 25 50C25 56.3229 27.3473 62.0975 31.218 66.5H12.4554ZM33.5 88.6349V91.5H43.4996C40.0053 90.9571 36.6534 89.9834 33.5 88.6349ZM56.5005 91.5H66.5V88.6349C63.3467 89.9834 59.9948 90.9571 56.5005 91.5ZM66.5 87.5446C61.4515 89.7665 55.8698 91 50 91C44.1302 91 38.5486 89.7665 33.5 87.5446V68.7821C37.9026 72.6528 43.6772 75 50 75C56.3229 75 62.0975 72.6528 66.5 68.7821V87.5446ZM87.5446 66.5H68.7821C72.6528 62.0975 75 56.3229 75 50C75 43.6772 72.6528 37.9026 68.7821 33.5H87.5446C89.7665 38.5486 91 44.1302 91 50C91 55.8698 89.7665 61.4515 87.5446 66.5ZM88.6349 66.5H91.5V56.5005C90.9571 59.9948 89.9834 63.3467 88.6349 66.5ZM33.5759 32.5C37.8692 28.4691 43.6463 26 50 26C56.3538 26 62.1309 28.4691 66.4242 32.5H33.5759ZM32.5 66.4242C28.4691 62.1309 26 56.3538 26 50C26 43.6463 28.4691 37.8692 32.5 33.5759V66.4242ZM66.4242 67.5C62.1309 71.531 56.3538 74 50 74C43.6463 74 37.8692 71.531 33.5759 67.5H66.4242ZM67.5 33.5759C71.531 37.8692 74 43.6463 74 50C74 56.3538 71.531 62.1309 67.5 66.4242V33.5759Z" fill="white"/>
          </g>
        </svg>
      </div>
    </a>
    <transition name="grow-transition">
      <span 
        class="btn-uninstall cursor-pointer"
        v-if="showUninstallButton && !isUninstalling"
        @click="confirmUninstall"
      >
        <svg class="" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M3.41421 0.585786C2.63316 -0.195262 1.36684 -0.195262 0.585786 0.585786C-0.195262 1.36684 -0.195262 2.63316 0.585786 3.41421L5.96528 8.7937L0.585872 14.1731C-0.195177 14.9542 -0.195177 16.2205 0.585872 17.0015C1.36692 17.7826 2.63325 17.7826 3.4143 17.0015L8.7937 11.6221L14.1731 17.0015C14.9542 17.7826 16.2205 17.7826 17.0015 17.0015C17.7826 16.2205 17.7826 14.9542 17.0015 14.1731L11.6221 8.7937L17.0016 3.41421C17.7827 2.63316 17.7827 1.36684 17.0016 0.585786C16.2206 -0.195262 14.9542 -0.195262 14.1732 0.585786L8.7937 5.96528L3.41421 0.585786Z" fill="white" fill-opacity="1"/>
        </svg>
      </span>
    </transition>
    <span v-if="isUninstalling" class="installed-app-title px-1 text-center text-small text-white text-truncate">Uninstalling...</span>
    <span v-else-if="isOffline" class="installed-app-title px-1 text-center text-small text-white text-truncate">Starting...</span>
    <span v-else class="installed-app-title px-1 text-center font-weight-medium text-truncate text-white">{{ app.name }}</span>
  
    <!-- app dependants modal -->
    <b-modal v-if="dependants.length" ref="app-dependants-modal" body-class="pt-1" size="sm" centered hide-footer>
      <template v-slot:modal-header="{ close }">
        <div class="pt-2 d-flex justify-content-between w-100 px-2">
          <span class="font-weight-bol mb-0">{{ app.name }} is being used by</span>
          <!-- Emulate built in modal header close button action -->
          <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z" fill="#6c757d"/>
            </svg>
          </a>
        </div>
      </template>
      <template #default="{ hide }">
        <div class="px-2">
          <div
            class="d-flex align-items-center justify-content-between mb-2"
            v-for="dependant in dependants"
            :key="dependant.id"
          >
            <div class="d-flex align-items-center">
              <img
                :src="`https://getumbrel.github.io/umbrel-apps-gallery/${dependant.id}/icon.svg`"
                class="mr-2 app-icon app-icon-xs"
              />
              <span class="">{{ dependant.name }}</span>
            </div>
          </div>
          <small class="text-muted" style="line-height: 1;">Uninstall {{dependants.length > 1 ? 'these apps' : dependants[0]['name']}} first to uninstall {{ app.name }}</small>
          <b-button
            variant="success"
            class="my-2"
            block
            @click="hide"
          >
            Ok
          </b-button>
        </div>
      </template>
    </b-modal>

    <!-- uninstall confirmation modal -->
    <b-modal v-if="showUninstallConfirmation" ref="uninstall-modal" body-class="pt-1" size="sm" centered hide-footer v-model="showUninstallConfirmation">
      <template v-slot:modal-header="{ close }">
        <div class="pt-2 d-flex justify-content-between  w-100 px-2">
          <span class="font-weight-bold mb-0">Uninstall {{ app.name }}?</span>
          <!-- Emulate built in modal header close button action -->
          <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z" fill="#6c757d"/>
            </svg>
          </a>
        </div>
      </template>
      <template #default="{ close }">
        <div class="px-2">
          All data associated with {{ app.name }} will be permanently deleted. This action cannot be undone.
          <div class="mt-3 mb-2 d-flex flex-wra">
            <b-button
              variant="outline-primary"
              class="mr-1 w-100"
              @click="close"
            >
              Cancel
            </b-button>
            <b-button
              variant="danger"
              class="ml-1 w-100"
              @click="uninstall"
            >
              Uninstall
            </b-button>
          </div>
        </div>
      </template>
    </b-modal>

  </div>
</template>

<script>
import { mapState } from "vuex";

import delay from "@/helpers/delay";

export default {
  props: {
    app: Object,
    showUninstallButton: {
      type: Boolean,
      default: false,
    },
    isUninstalling: {
      type: Boolean,
      default: false,
    },
    torOnly: {
      type: Boolean,
      default: false,
    },
    dependencies: Array
  },
  data() {
    return {
      isOffline: false,
      checkIfAppIsOffline: true,
      showUninstallConfirmation: false,
      iconLoaded: false
    };
  },
  computed: {
    ...mapState({
      installedApps: (state) => state.apps.installed
    }),
    url: function () {
      if (window.location.origin.indexOf(".onion") > 0) {
        return `http://${this.app.hiddenService}${this.app.path}`;
      } else {
        if (this.torOnly) {
          return "#";
        }
        return `${window.location.protocol}//${window.location.hostname}:${this.app.port}${this.app.path}`;
      }
    },
    dependants: function() {
      return this.installedApps.filter(app => app.dependencies.includes(this.app.id));
    }
  },
  methods: {
    async onIconLoad() {
      this.iconLoaded = true;
    },
    confirmUninstall() {
      if (this.dependants.length) {
        return this.$refs['app-dependants-modal'].show();
      }
      return this.showUninstallConfirmation = true;
    },
    async uninstall() {
      try {
        this.showUninstallConfirmation = false;
        await this.$store.dispatch("apps/uninstall", this.app.id);
      }
      catch (error) {
        if (error.response && error.response.data) {
          this.$bvToast.toast(error.response.data, {
            title: "Error",
            autoHideDelay: 3000,
            variant: "danger",
            solid: true,
            toaster: "b-toaster-bottom-right",
          });
        }
      }
    },
    openApp(event) {
      if (this.torOnly && window.location.origin.indexOf(".onion") < 0) {
        event.preventDefault();
        alert(`${this.app.name} can only be used over Tor. Please access your Umbrel in a Tor browser on your remote access URL (Settings > Account > Remote access) to open this app.`);
        return;
      }
      if (this.isUninstalling) {
        event.preventDefault();
        return;
      }
      return;
    },
    async pollOfflineApp() {
      this.checkIfAppIsOffline = true;
      while (this.checkIfAppIsOffline) {
        try {
          await window.fetch(this.url, {mode: "no-cors" });
          this.isOffline = false;
          this.checkIfAppIsOffline = false;
        } catch (error) {
          this.isOffline = true;
        }
        await delay(1000);
      }
    }
  },
  created() {
    this.pollOfflineApp();
  },
  beforeDestroy() {
    this.checkIfAppIsOffline = false;
  },
  components: {},
};
</script>

<style lang="scss" scoped>
.installed-app {
  width: var(--app-width, 140px);
  height: 140px;
  position: relative;
  .installed-app-link {
    text-decoration: none;
    .installed-app-icon-container {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      position: relative;
      box-shadow: 1px 2px 14px rgba(0, 0, 0, 0.20);
      .installed-app-icon {
        width: 100%;
        height: 100%;
        border: none;
        object-fit: cover;
        transition: transform 0.2s ease;
      }
      .installed-app-icon-frame {
        position: absolute;
        left: 1px;
        top: 1px;
        z-index: -1;
        border: solid 1px #ffffff;
        border-radius: 18px;
        opacity: 0.5;
        object-fit: cover;
        width: calc(100% - 2px);
        height: calc(100% - 2px);
        transition: transform 0.2s ease;
      }
    }
    &:hover {
      .installed-app-icon, .installed-app-icon-frame {
        transform: scale3d(1.03, 1.03, 1.03);
      }
    }
    &:active {
      .installed-app-icon {
        filter: brightness(0.5)
      }
      .installed-app-icon-frame {
        backdrop-filter: brightness(0.4);
      }
    }
  }
  .installed-app-title {
    text-shadow: 1px 1px 3px rgb(0 0 0 / 30%);
  }
  .btn-uninstall {
    position: absolute;
    top: -7px;
    right: 26px;
    height: 26px;
    width: 26px;
    background: #FF4E4E;
    border-radius: 50%;
    box-shadow: -4px 4px 4px rgba(0, 0, 0, 0.1);
    transition: transform 0.4s, opacity 0.4s ease;
    z-index: 2;
    svg {
      position: absolute;
      top: 50%;
      left: 50%;
      height: 10px;
      width: 10px;
      transform: translate3d(-50%, -50%, 0);
    }
    &:hover {
      transform: scale3d(1.1, 1.1, 1.1);
    }
  }
}

.dim-in-out {
  animation: dim-in-out 1s infinite linear;
}
@keyframes dim-in-out {
  0%,
  100% {
      filter: brightness(0.6);
  }
  50% {
      filter: brightness(0.4);
  }
}

.background-dim-in-out {
  animation: background-dim-in-out 1s infinite linear;
}

@keyframes background-dim-in-out {
  0%,
  100% {
      backdrop-filter: brightness(1);
  }
  50% {
      backdrop-filter: brightness(0.8);
  }
}

</style>
