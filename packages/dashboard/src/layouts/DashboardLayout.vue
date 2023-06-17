<template>
  <div>
    <b-navbar type="light" variant="default" class="nav-horizontal">
      <div>
        <b-navbar-brand to="/dashboard">
          <img src="@/assets/logo.svg" alt="Umbrel" height="50" />
        </b-navbar-brand>
      </div>

      <!-- <b-navbar-toggle target="nav-collapse"></b-navbar-toggle> -->

      <!-- Search Bar -->
      <!-- <b-navbar-nav>
        <div class="px-lg-4 px-xl-5 mx-xl-4"></div>
        <b-nav-form class="input-search-form">
          <b-form-input
            size="sm"
            class="input-search"
            placeholder="Search for transactions, addresses, etc."
          ></b-form-input>
          <div class="input-search-icon"></div>
        </b-nav-form>
      </b-navbar-nav>-->

      <!-- Right aligned nav items -->
      <b-navbar-nav class="ml-auto">
        <!-- Chain badge -->
        <b-badge
          variant="success"
          v-if="chain !== 'main'"
          class="align-self-center mr-2 text-capitalize"
          pill
          >{{ chain === "test" ? "testnet" : chain }}</b-badge
        >

        <div
          class="nav-hamburger-icon d-lg-none d-xl-none ml-1"
          :class="{ active: isMobileMenuOpen }"
          @click="toggleMobileMenu"
        >
          <div></div>
        </div>
        <b-nav-item-dropdown
          class="d-none d-lg-block d-xl-block"
          right
          no-caret
        >
          <!-- Using 'button-content' slot -->
          <template v-slot:button-content>{{ name.split(" ")[0] }}</template>
          <b-dropdown-item @click="logout">Log out</b-dropdown-item>
        </b-nav-item-dropdown>
      </b-navbar-nav>
    </b-navbar>

    <!-- Mobile menu -->
    <transition name="mobile-vertical-menu">
      <div
        class="mobile-vertical-menu d-lg-none d-xl-none"
        v-if="isMobileMenuOpen"
      >
        <authenticated-vertical-navbar :isMobileMenu="true" />
      </div>
    </transition>

    <transition name="mobile-vertical-menu-fader">
      <div
        class="mobile-vertical-menu-fader d-lg-none d-xl-none"
        v-if="isMobileMenuOpen"
        @click="toggleMobileMenu"
      ></div>
    </transition>

    <b-row class="mx-0">
      <b-col
        col
        lg="3"
        xl="2"
        class="d-none d-lg-block d-xl-block pl-0 pr-0 pr-xl-2"
      >
        <authenticated-vertical-navbar />
      </b-col>

      <b-col col lg="9" xl="10">
        <b-modal
          id="confirm-update-modal"
          size="lg"
          centered
          hide-footer
          v-if="availableUpdate.version"
          v-model="showUpdateConfirmationModal"
        >
          <template v-slot:modal-header>
            <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
              <h3>Umbrel v{{ availableUpdate.version }}</h3>
              <!-- Emulate built in modal header close button action -->
              <a
                href="#"
                class="align-self-center"
                v-on:click.stop.prevent="hideUpdateConfirmationModal"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                    fill="#6c757d"
                  />
                </svg>
              </a>
            </div>
          </template>
          <div class="px-2 px-sm-3 pb-2 pb-sm-3">
            <div class>
              <p class="text-newlines" v-if="availableUpdate.notes">
                {{ availableUpdate.notes }}
              </p>
              <b-alert variant="warning" show>
                <small
                  >Please download the latest backup of your payment channels
                  before updating and make sure to note down your 24 secret
                  words (if you haven't already). You'll need these to recover
                  your funds in case something goes wrong.</small
                >
                <b-button
                  class="mt-2 mb-1 d-block"
                  variant="warning"
                  size="sm"
                  @click="downloadChannelBackup"
                >
                  <small> <b-icon icon="download" class="mr-1"></b-icon> </small
                  >Download channel backup
                </b-button>
              </b-alert>
              <b-button
                block
                variant="success"
                :disabled="isUpdating"
                @click="startUpdate"
                >{{
                  isUpdating ? "Starting update..." : "Install now"
                }}</b-button
              >
            </div>
          </div>
        </b-modal>
        <div class="pr-xl-2 content-container">
          <b-alert
            class="mt-4 mb-0"
            variant="success"
            :show="!!availableUpdate.version"
            dismissible
          >
            <b-icon icon="bell-fill" class="mr-2"></b-icon>
            <a
              :href="`https://github.com/getumbrel/umbrel/releases/tag/v${availableUpdate.version}`"
              target="_blank"
              class="alert-link"
              >Umbrel v{{ availableUpdate.version }}</a
            >
            &nbsp;is now available to install
            <a
              href="#"
              class="alert-link float-right"
              @click.prevent="confirmUpdate"
              v-show="!isUpdating"
              >Install now</a
            >
            <b-spinner
              v-show="isUpdating"
              variant="success"
              small
              class="float-right mt-1"
            ></b-spinner>
          </b-alert>
          <b-alert class="mt-4 mb-0" variant="warning" v-if="isRunningLowOnRam" show dismissible>
            <b-icon icon="exclamation-circle" class="mr-2"></b-icon>
            <b>Low RAM:</b> Your Umbrel is running low on RAM.
            Consider uninstalling some apps or upgrading your Umbrel's hardware.
            <router-link to="/settings#ram" class="alert-link float-right">View usage</router-link>
          </b-alert>
          <b-alert class="mt-4 mb-0" variant="warning" v-if="isRunningLowOnStorage" show dismissible>
            <b-icon icon="exclamation-circle" class="mr-2"></b-icon>
            <b>Low storage:</b> Your Umbrel only has {{ readableSize(storage.total - storage.used) }} of storage left.
            Consider uninstalling some apps or upgrading to a larger drive.
            <router-link to="/settings#storage" class="alert-link float-right">View usage</router-link>
          </b-alert>
          <b-alert class="mt-4 mb-0" variant="warning" v-if="isUmbrelOS && isRunningHot" show dismissible>
            <b-icon icon="exclamation-circle" class="mr-2"></b-icon>
            <b>High temperature:</b> Your Raspberry Pi is running hot. Consider using a heatsink, fan or a cooling case.
          </b-alert>
          <transition name="change-page" mode="out-in">
            <!-- Content -->
            <router-view></router-view>
          </transition>
        </div>

        <!-- Footer -->
        <footer class="d-flex justify-content-end text-muted pr-sm-2 pr-xl-3">
          <p>
            <small>
              <a href="https://getumbrel.com" target="_blank">getumbrel.com</a>
              |
              <a href="https://community.getumbrel.com" target="_blank">community</a>
            </small>
          </p>
        </footer>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import { mapState } from "vuex";
import { readableSize } from "@/helpers/size";
import API from "@/helpers/api";
import AuthenticatedVerticalNavbar from "@/components/AuthenticatedVerticalNavbar";

export default {
  data() {
    return {
      isUpdating: false
    };
  },
  computed: {
    ...mapState({
      name: (state) => state.user.name,
      chain: (state) => state.bitcoin.chain,
      availableUpdate: (state) => state.system.availableUpdate,
      updateStatus: (state) => state.system.updateStatus,
      showUpdateConfirmationModal: (state) => state.system.showUpdateConfirmationModal,
      ram: (state) => state.system.ram,
      storage: (state) => state.system.storage,
      isUmbrelOS: (state) => state.system.isUmbrelOS,
      cpuTemperature: (state) => state.system.cpuTemperature,
    }),
    isRunningLowOnRam() {
      // over 95% RAM used
      if (this.ram && this.ram.total) {
        return this.ram.used / this.ram.total > 0.95
      }
      return false;
    },
    isRunningLowOnStorage() {
      // less than 1GB remaining
      if (this.storage && this.storage.total) {
        return this.storage.total - this.storage.used < 1000000000;
      }
      return false;
    },
    isRunningHot() {
      // over 80'C
      if (this.cpuTemperature) {
        return this.cpuTemperature > 80;
      }
      return false;
    },
    isMobileMenuOpen() {
       return this.$store.getters.isMobileMenuOpen;
    },
  },
  methods: {
    async logout() {
      //close mobile menu
      if (this.isMobileMenuOpen) {
        this.toggleMobileMenu();
      }
      await this.$store.dispatch("user/logout");
    },
    fetchData() {
      this.$store.dispatch("system/getUnit");
      this.$store.dispatch("bitcoin/getSync");
      this.$store.dispatch("bitcoin/getBalance");
      this.$store.dispatch("bitcoin/getTransactions");
      this.$store.dispatch("lightning/getSync");
      this.$store.dispatch("lightning/getTransactions");
      this.$store.dispatch("lightning/getChannels");
      this.$store.dispatch("bitcoin/getPrice");
      this.$store.dispatch("system/getIsUmbrelOS");
      this.$store.dispatch("system/getAvailableUpdate");
      this.$store.dispatch("system/getRam");
      this.$store.dispatch("system/getStorage");
      this.$store.dispatch("system/getCpuTemperature");
    },
    toggleMobileMenu() {
      this.$store.commit("toggleMobileMenu");
    },
    async downloadChannelBackup() {
      await API.download(
        `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/util/download-channel-backup`,
        {},
        true,
        "my-umbrel-channels.backup"
      );
    },
    hideUpdateConfirmationModal() {
      this.$store.dispatch("system/hideUpdateConfirmationModal");
    },
    confirmUpdate() {
      this.$store.dispatch("system/confirmUpdate");
    },
    async startUpdate() {
      try {
        await API.post(
          `${process.env.VUE_APP_MANAGER_API_URL}/v1/system/update`,
          {}
        );
        this.isUpdating = true;
        // poll update status every 2s until the update process begins
        // because after it's updated, the loading view will take over
        this.pollUpdateStatus = window.setInterval(async () => {
          await this.$store.dispatch("system/getUpdateStatus");
          if (this.updateStatus.state === "installing") {
            window.clearInterval(this.pollUpdateStatus);
          }
        }, 2 * 1000);
      } catch (error) {
        this.$bvToast.toast(`Unable to start the update process`, {
          title: "Error",
          autoHideDelay: 3000,
          variant: "danger",
          solid: true,
          toaster: "b-toaster-bottom-right",
        });
      }
    },
    readableSize(n) {
      return readableSize(n);
    },
  },
  created() {
    //load this data once:
    this.$store.dispatch("user/getInfo");

    //refresh this data every 20s:
    this.fetchData();
    this.interval = window.setInterval(this.fetchData, 20000);
  },
  beforeDestroy() {
    window.clearInterval(this.interval);
    if (this.pollUpdateStatus) {
      window.clearInterval(this.pollUpdateStatus);
    }
  },
  watch: {},
  components: {
    AuthenticatedVerticalNavbar,
  },
};
</script>

<style lang="scss" scoped>
.nav-horizontal {
  background: #fff;
  position: sticky;
  z-index: 9;
}

.nav-horizontal {
  top: 0;
}

.content-container {
  min-height: calc(100vh - 150px);
}

.input-search-form {
  form {
    position: relative;
  }
  .input-search {
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    width: calc(100vw - 200px);
    max-width: 600px;
    font-size: 1rem;
    margin-left: 1rem;
  }
  .input-search-icon {
    content: url("~@/assets/icon-search.svg");
    position: absolute;
    top: calc(50% - 0.625rem);
    left: -0.25rem;
    height: 1.25rem;
    width: auto;
  }
}

::-webkit-input-placeholder {
  /* Edge */
  color: #c3c6d1;
}

:-ms-input-placeholder {
  /* Internet Explorer 10-11 */
  color: #c3c6d1;
}

::placeholder {
  color: #c3c6d1;
}

.nav-hamburger-icon {
  width: 24px;
  cursor: pointer;
  &:before,
  &:after,
  div {
    background-color: #c3c6d1;
    border-radius: 3px;
    content: "";
    display: block;
    height: 4px;
    width: 100%;
    margin: 5px 0;
    transition: transform 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
  div {
    width: 20px;
    margin-left: 4px;
  }
  &.active {
    &:before {
      transform: translateY(9px) rotate(135deg);
    }
    &:after {
      transform: translateY(-9px) rotate(-135deg);
    }
    div {
      transform: scale(0);
    }
  }
}

.mobile-vertical-menu {
  position: fixed;
  z-index: 9;
  top: 84px;
  right: 0;
  width: 80vw;
  max-width: 280px;
  height: calc(var(--vh100, 100vh) - 84px);
  background: #fff;
  box-shadow: 0px 10px 30px rgba(209, 213, 223, 0.5);
  transition: transform 0.6s cubic-bezier(0.77, 0, 0.175, 1);
}

.mobile-vertical-menu-enter {
  // opacity: 0;
  transform: translate3d(100%, 0, 0);
}
.mobile-vertical-menu-enter-to {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}
.mobile-vertical-menu-leave {
  opacity: 1;
  transform: translate3d(0, 0, 0);
}
.mobile-vertical-menu-leave-to {
  // opacity: 0;
  transform: translate3d(100%, 0, 0);
}

.mobile-vertical-menu-fader {
  position: fixed;
  height: var(--vh100, 100vh);
  width: 100vw;
  left: 0;
  top: 0;
  background: rgba(0, 0, 0, 1);
  z-index: 8;
  opacity: 0.1;
  transition: opacity 0.6s ease-in-out;
}

.mobile-vertical-menu-fader-enter {
  opacity: 0;
}
.mobile-vertical-menu-fader-enter-to {
  opacity: 0.1;
}
.mobile-vertical-menu-fader-leave {
  opacity: 0.1;
}
.mobile-vertical-menu-fader-leave-to {
  opacity: 0;
}

// Page changing transitions
.change-page-enter-active,
.change-page-leave-active {
  transition: transform 0.4s, opacity 0.4s ease;
}
.change-page-enter {
  transform: translate3d(-40px, 0, 0);
  opacity: 0;
}
.change-page-enter-to {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
.change-page-leave {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
.change-page-leave-to {
  transform: translate3d(40px, 0, 0);
  opacity: 0;
}
</style>
