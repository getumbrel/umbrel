<template>
<div class="">
  <div class="app-suggestions-container d-flex flex-column align-items-center mx-auto px-2 py-4 px-sm-4">
    <h2 class="app-suggestions-heading text-center mb-1">Install your first app</h2>
    <b-row>
      <b-col
        v-for="suggestion in suggestions" 
        :key="suggestion.title"
        lg="4"
      >
        <h4 class="font-weight-normal text-center suggestion-title mb-2 mt-3">{{ suggestion.title }}</h4>
        <card-widget
          class="pt-4 pb-2 d-block mx-auto card-app-list"
        >
          <router-link
            v-for="appId in suggestion.apps"
            :key="appId"
            :to="{name: 'app-store-app', params: {id: appId}}"
            class="app-list-app d-flex justify-content-between align-items-center p-3"
          >
            <div class="d-flex">
              <div class="d-block">
                <img
                  class="app-icon mr-2 mr-lg-3"
                  :src="getAppIcon(appId)"
                  draggable="false"
                />
              </div>
              <div class="d-flex justify-content-center flex-column">
                <h4 class="app-name text-title-color mb-1">
                  {{ getAppName(appId) }}
                </h4>
                <p class="app-tagline text-muted mb-0">
                  {{ getAppTagline(appId) }}
                </p>
              </div>
            </div>
            <div class="ml-2 icon-arrow-container">
              <svg
                viewBox="0 0 14 25"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                class="icon-arrow"
              >
                <path
                  d="M0.512563 3.0484C-0.170855 2.35104 -0.170855 1.22039 0.512563 0.523023C1.19598 -0.174341 2.30402 -0.174341 2.98744 0.523023L13.4874 11.2373C14.1499 11.9133 14.1731 13.0019 13.54 13.7066L3.91502 24.4209C3.26193 25.1479 2.15494 25.197 1.44248 24.5306C0.730023 23.8642 0.681893 22.7346 1.33498 22.0076L9.82776 12.5537L0.512563 3.0484Z"
                  fill="#C3C6D1"
                />
              </svg>
            </div>
          </router-link>
        </card-widget>
      </b-col>
    </b-row>
    <router-link
      :to="{name: 'app-store'}"
      class="btn btn-sm rounded-pill btn-success text-uppercase mt-3 font-weight-bold px-3 py-2 mx-auto text-center"
    >View more in app store</router-link>
  </div>
</div>
</template>

<script>
import { mapState } from "vuex";

import CardWidget from "@/components/CardWidget";

export default {
  data() {
    return {
      suggestions: [
        {
          title: "For the bitcoiner",
            apps: ['bitcoin', 'lightning', 'mempool', 'thunderhub', 'electrs'],
        },
        {
          title: "For the self-hoster",
            apps: ['nextcloud', 'home-assistant', 'pi-hole', 'tailscale', 'uptime-kuma'],
        },
        {
          title: "For the streamer",
            apps: ['plex', 'jellyfin', 'transmission', 'sonarr', 'radarr'],
        },
      ]
    };
  },
  computed: {
    ...mapState({
      appStore: (state) => state.apps.store,
    }),
  },
  methods: {
    getAppName(appId) {
      return this.appStore.find((app) => app.id === appId)['name'];
    },
    getAppTagline(appId) {
      return this.appStore.find((app) => app.id === appId)['tagline'];
    },
    getAppIcon(appId) {
      return this.appStore.find((app) => app.id === appId)['icon'];
    },
  },
  components: {
    CardWidget,
  }
};
</script>

<style lang="scss" scoped>
.app-suggestions-container {
  margin-bottom: 8rem;
  .app-suggestions-heading {
    opacity: 0.8;
  }
  .suggestion-title {
    opacity: 0.5;
  }
  width: calc(100% - 20px);
  max-width: 700px;
  border-radius: 16px;
  background-color: var(--app-suggestions-container-background-color);
  box-shadow: 0px 0px 100px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(60px) saturate(150%);
}
.card-app-list {
  max-width: 400px;
  .app-name {
    font-weight: 600;
    height: 1.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  }
  .app-tagline {
    font-size: 100%;
    line-height: 1.5em;
    height: 3rem;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}
</style>
