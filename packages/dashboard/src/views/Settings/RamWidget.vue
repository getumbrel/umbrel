<template>
  <card-widget
      header="RAM"
      :status="cardStatus"
    >
    <div class="card-custom-body">
      <div class="card-app-info px-3 px-xl-4">
        <div class="d-flex w-100 justify-content-between mb-4">
          <div>
            <div>
              <h3 class="mb-1">{{ readableSize(ram.used) }}</h3>
              <p class="text-muted mb-0">Used out of {{ readableSize(ram.total) }} </p>
            </div>
          </div>

          <svg width="66" height="66" viewBox="0 0 66 66" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="66" height="66" rx="12" fill="url(#paint0_linear)"/>
            <path d="M21.95 17C21.4808 17 21.1 17.3858 21.1 17.8611V19.5833C21.1 20.0587 21.4808 20.4444 21.95 20.4444H23.65C24.1192 20.4444 24.5 20.0587 24.5 19.5833V17.8611C24.5 17.3858 24.1192 17 23.65 17H21.95ZM28.75 17C28.2808 17 27.9 17.3858 27.9 17.8611V19.5833C27.9 20.0587 28.2808 20.4444 28.75 20.4444H30.45C30.9192 20.4444 31.3 20.0587 31.3 19.5833V17.8611C31.3 17.3858 30.9192 17 30.45 17H28.75ZM35.55 17C35.0808 17 34.7 17.3858 34.7 17.8611V19.5833C34.7 20.0587 35.0808 20.4444 35.55 20.4444H37.25C37.7192 20.4444 38.1 20.0587 38.1 19.5833V17.8611C38.1 17.3858 37.7192 17 37.25 17H35.55ZM42.35 17C41.8808 17 41.5 17.3858 41.5 17.8611V19.5833C41.5 20.0587 41.8808 20.4444 42.35 20.4444H44.05C44.5192 20.4444 44.9 20.0587 44.9 19.5833V17.8611C44.9 17.3858 44.5192 17 44.05 17H42.35ZM19.4 22.1667C17.5249 22.1667 16 23.7115 16 25.6111V39.3889C16 41.2885 17.5249 42.8333 19.4 42.8333H46.6C48.4751 42.8333 50 41.2885 50 39.3889V25.6111C50 23.7115 48.4751 22.1667 46.6 22.1667H19.4ZM21.1 25.6111C22.0384 25.6111 22.8 26.3827 22.8 27.3333C22.8 28.284 22.0384 29.0556 21.1 29.0556C20.1616 29.0556 19.4 28.284 19.4 27.3333C19.4 26.3827 20.1616 25.6111 21.1 25.6111ZM44.9 35.9444C45.8384 35.9444 46.6 36.716 46.6 37.6667C46.6 38.6173 45.8384 39.3889 44.9 39.3889C43.9616 39.3889 43.2 38.6173 43.2 37.6667C43.2 36.716 43.9616 35.9444 44.9 35.9444ZM21.95 44.5556C21.4808 44.5556 21.1 44.9413 21.1 45.4167V47.1389C21.1 47.6142 21.4808 48 21.95 48H23.65C24.1192 48 24.5 47.6142 24.5 47.1389V45.4167C24.5 44.9413 24.1192 44.5556 23.65 44.5556H21.95ZM28.75 44.5556C28.2808 44.5556 27.9 44.9413 27.9 45.4167V47.1389C27.9 47.6142 28.2808 48 28.75 48H30.45C30.9192 48 31.3 47.6142 31.3 47.1389V45.4167C31.3 44.9413 30.9192 44.5556 30.45 44.5556H28.75ZM35.55 44.5556C35.0808 44.5556 34.7 44.9413 34.7 45.4167V47.1389C34.7 47.6142 35.0808 48 35.55 48H37.25C37.7192 48 38.1 47.6142 38.1 47.1389V45.4167C38.1 44.9413 37.7192 44.5556 37.25 44.5556H35.55ZM42.35 44.5556C41.8808 44.5556 41.5 44.9413 41.5 45.4167V47.1389C41.5 47.6142 41.8808 48 42.35 48H44.05C44.5192 48 44.9 47.6142 44.9 47.1389V45.4167C44.9 44.9413 44.5192 44.5556 44.05 44.5556H42.35Z" fill="white"/>
            <defs>
              <linearGradient v-if="isRamFull" id="paint0_linear" x1="0" y1="0" x2="66" y2="66" gradientUnits="userSpaceOnUse">
                <stop stop-color="#F2766E"/>
                <stop offset="1" stop-color="#B63114"/>
              </linearGradient>
              <linearGradient v-else-if="isRunningLowOnRam" id="paint0_linear" x1="0" y1="0" x2="66" y2="66" gradientUnits="userSpaceOnUse">
                <stop stop-color="#F4E44E"/>
                <stop offset="1" stop-color="#F1BB6B"/>
              </linearGradient>
              <linearGradient v-else id="paint0_linear" x1="0" y1="0" x2="66" y2="66" gradientUnits="userSpaceOnUse">
                <stop stop-color="#8AE9A4"/>
                <stop offset="1" stop-color="#499D56"/>
              </linearGradient>
            </defs>
          </svg>

        </div>
      </div>
      <div class>
        <div class="px-3 px-xl-4 mb-3">
          <b-progress
            :value="Math.round(ram.used * 100/ram.total)"
            class="mb-1"
            :style="{ height: '5px' }"
            :variant="isRunningLowOnRam ? (isRamFull ? 'danger' : 'warning') : 'success'"
          ></b-progress>
          <div class="text-right">
            <small class="text-muted">{{ readableSize(ram.total - ram.used) }} available</small>
          </div>

          <b-alert v-if="isRunningLowOnRam" :variant="isRamFull ? 'danger' : 'warning'" class="mt-3" show>
            <small>Consider uninstalling some apps.</small>
          </b-alert>
        </div>
        <div class="pt-1">
            <b-link v-b-toggle.ram-breakdown-collapse class="card-link primary-link px-3 px-xl-4">
              <span class="when-closed">View usage</span>
              <span class="when-open">Hide usage</span>
            </b-link>
            <div class="pb-4"></div>
            <b-collapse id="ram-breakdown-collapse">
              <ul class="app-stat-list px-3 px-xl-4">
                <li v-for="app in ram.breakdown" :key="app.id" class="app-stat-list-item mb-2">
                  <div class="d-flex align-items-center">
                    <img
                        v-if="app.id === 'umbrel'"
                        class="app-stat-list-item-icon mr-2"
                        :src="require(`@/assets/icon-system.svg`)"
                      />
                      <img
                        v-else
                        class="app-stat-list-item-icon mr-2"
                        :src="app.icon"
                    />
                    <div class="w-100">
                      <div class="d-flex justify-content-between align-items-baseline">
                        <span v-if="app.id === 'umbrel'">System
                          <!-- <b-icon icon="info-circle-fill" style="opacity: 0.4" variant="dark" class="ml-1"></b-icon> -->
                        </span>
                        <span v-else>{{ app.name }}</span>

                        <!-- There's an edge case where a negative value may be returned by the API -->
                        <small v-if="app.used < 0" class="text-muted">Calculating...</small>
                        <small v-else class="text-muted">{{ readableSize(app.used) }}</small>
                      </div>
                      <b-progress
                        :value="Math.round(app.used * 100/ram.used)"
                        class="mt-1"
                        variant="success"
                        :style="{ height: '2px' }"
                      ></b-progress>
                    </div>
                  </div>
                </li>
                <li class="app-stat-list-item pb-3"></li>
              </ul>
            </b-collapse>
        </div>
      </div>
      </div>
    </card-widget>
</template>

<script>
import { mapState } from "vuex";

import { readableSize } from "@/helpers/size";

import CardWidget from "@/components/CardWidget";

export default {
  data() {
    return {
      // ram: {
      //   total: 4000000000,
      //   used: 3100000000,
      //   breakdown: []
      // }
    };
  },
  props: {
  },
  computed: {
    ...mapState({
      store: state => state.apps.store,
      ram: state => state.system.ram,
    }),
    isRunningLowOnRam() {
      if (this.ram && this.ram.total) {
        return this.ram.used / this.ram.total > 0.95
      }
      return false;
    },
    isRamFull() {
      if (this.ram && this.ram.total) {
        return this.ram.used / this.ram.total > 0.99
      }
      return false;
    },
    cardStatus() {
      if (this.isRamFull) {
        return {
          text: "RAM full",
          variant: "danger",
          blink: true
        };
      }
      if (this.isRunningLowOnRam) {
        return {
          text: "Low RAM",
          variant: "warning",
          blink: true
        };
      }
      return {};
    },
  },
  created() {
    // to map app ID's to app names
    this.$store.dispatch("apps/getAppStore");

    // setTimeout(() => {
    //   this.ram.used = 3750000000;
    //   setInterval(() => { 
    //   if (this.ram.used !== 4000000000) {
    //     this.ram.used += 5000000;
    //   }
    //  }, 250);
    // }, 3000);
  },
  methods: {
    readableSize(n) {
      return readableSize(n);
    }
  },
  components: {
    CardWidget,
  }
};
</script>

<style lang="scss" scoped></style>
