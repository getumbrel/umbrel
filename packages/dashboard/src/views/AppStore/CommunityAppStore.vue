<template>
  <div class="pt-2">
    <div class="mt-3">
      <div class="">
        <b-link
        v-if="communityAppStoreId"
        :to="{name: 'app-store'}"
        class="card-link primary-link d-inline-block mb-4"
        ><svg
          width="7"
          height="13"
          viewBox="0 0 7 13"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          class="mr-1"
        >
          <path
            d="M6.74372 11.4153C7.08543 11.7779 7.08543 12.3659 6.74372 12.7285C6.40201 13.0911 5.84799 13.0911 5.50628 12.7285L0.256283 7.15709C-0.0749738 6.80555 -0.0865638 6.23951 0.229991 5.87303L5.04249 0.301606C5.36903 -0.0764332 5.92253 -0.101971 6.27876 0.244565C6.63499 0.591101 6.65905 1.17848 6.33251 1.55652L2.08612 6.47256L6.74372 11.4153Z"
            fill="#C3C6D1"
          />
        </svg>
        <small class="text-uppercase">Back to Umbrel App Store</small></b-link>

        <!-- Community app store header -->
        <div class="d-flex justify-content-between align-items-center">
          <div v-if="communityAppStoreId">
            <b-badge pill variant="primary" class="mb-1">
              Community App Store
            </b-badge>
            <h1 class="text-lowercase">
              {{ communityAppStore.name }} App Store
            </h1>
            <p class="text-muted mb-0">
              Discover and install apps from the {{ communityAppStore.name }} App Store
            </p>
            <div class="block w-100 py-3"></div>
          </div>

          <!-- Official app store header -->
          <div v-else>
            <h1 class="text-lowercase">App Store</h1>
            <p class="text-muted mb-0">Add super powers to your Umbrel with amazing self-hosted applications</p>
            <!-- Search  -->
            <div
              class="search-input-container mt-3 mb-2 d-flex align-items-center"
              :class="{'active': appStoreSearchQuery}"
            >
              <svg class="search-input-icon" width="18" height="21" viewBox="0 0 18 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12.5146 15.9941C11.319 16.6359 9.95202 17 8.5 17C3.80558 17 0 13.1944 0 8.5C0 3.80558 3.80558 0 8.5 0C13.1944 0 17 3.80558 17 8.5C17 11.0223 15.9013 13.2881 14.1564 14.8448L17.7809 19.3753C18.1259 19.8066 18.056 20.4359 17.6247 20.7809C17.1934 21.1259 16.5641 21.056 16.2191 20.6247L12.5146 15.9941ZM15 8.5C15 12.0899 12.0899 15 8.5 15C4.91015 15 2 12.0899 2 8.5C2 4.91015 4.91015 2 8.5 2C12.0899 2 15 4.91015 15 8.5Z" fill="#80838D"/>
              </svg>
              <b-input
                id="search-input"
                ref="searchInput"
                class="search-input"
                type="text"
                placeholder="Search apps"
                v-model="appStoreSearchQuery"
                @input="onTypeAppStoreSearchQuery"
              ></b-input>
            </div>
          </div>

          <div class="d-flex">
            <div class="position-relative mr-3" v-if="appsWithUpdate.length && !communityAppStoreId">
              <b-button variant="primary" class="px-3" v-b-modal.app-updates-modal>
                {{ `Update${appsWithUpdate.length > 1 ? 's' : ''}` }}
              </b-button>
              <transition name="grow-transition" appear>
                <span class="updates-badge text-white text-center mr-1">{{ appsWithUpdate.length }}</span>
              </transition>
            </div>
            <b-dropdown
              v-if="!communityAppStoreId"
              variant="link"
              toggle-class="text-decoration-none p-0"
              no-caret
              right
            >
              <template v-slot:button-content>
                <svg
                  width="18"
                  height="4"
                  viewBox="0 0 18 4"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M2 4C3.10457 4 4 3.10457 4 2C4 0.89543 3.10457 0 2 0C0.89543 0 0 0.89543 0 2C0 3.10457 0.89543 4 2 4Z"
                    fill="#6c757d"
                  />
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M9 4C10.1046 4 11 3.10457 11 2C11 0.89543 10.1046 0 9 0C7.89543 0 7 0.89543 7 2C7 3.10457 7.89543 4 9 4Z"
                    fill="#6c757d"
                  />
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M16 4C17.1046 4 18 3.10457 18 2C18 0.89543 17.1046 0 16 0C14.8954 0 14 0.89543 14 2C14 3.10457 14.8954 4 16 4Z"
                    fill="#6c757d"
                  />
                </svg>
              </template>
              <b-dropdown-item href="#" v-b-modal.community-app-stores-modal>Community App Stores</b-dropdown-item>
            </b-dropdown>

            <b-modal id="community-app-stores-modal" size="lg" body-class="py-0 px-2" header-class="mb-0 pb-0" centered hide-footer>
              <template v-slot:modal-header="{ close }">
                <div class="d-flex flex-column w-100">
                  <div class="d-flex justify-content-end w-100">
                    <a
                      href="#"
                      class="align-self-center"
                      v-on:click.stop.prevent="close"
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
                  <div class="d-flex align-items-center justify-content-between w-100 px-2 px-lg-3">
                    <h2 class="text-lowercase">Community App Stores</h2>
                  </div>
                </div>
              </template>
              <community-app-stores />
            </b-modal>
          </div>
        </div>
      </div>
    </div>

    <!-- Search results  -->
    <div v-if="!communityAppStoreId && appStoreSearchQuery && appStoreSearchResults.length" class="community-app-store-card-columns">
      <card-widget
        v-for="app in appStoreSearchResults"
        :key="app.id"
        class="pt-3 pb-1 pt-sm-4 pb-sm-2 card-app-list"
      >
        <router-link
          :to="{name: 'app-store-app', params: {id: app.id}}"
          class="app-list-app d-flex justify-content-between align-items-center px-3 px-lg-4 py-2 py-sm-3"
        >
          <div class="d-flex">
            <div class="d-block">
              <img
                class="app-icon mr-2 mr-lg-3"
                :src="app.icon"
                draggable="false"
              />
            </div>
            <div class="d-flex justify-content-center flex-column">
              <h3 class="app-name text-title-color mb-1">
                {{ app.name }}
              </h3>
              <p class="app-tagline text-muted mb-0">
                {{ app.tagline }}
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
    </div>

    <!-- No results found -->
    <div v-else-if="!communityAppStoreId && appStoreSearchQuery && !appStoreSearchResults.length && !isTypingAppStoreSearchQuery" class="w-100">
      <p class="text-muted">No results found</p>
      <transition name="no-search-results-transition" appear>
        <img class="no-search-results-image d-block mt-5 mx-auto" src="@/assets/no-search-results.gif" />
      </transition>
    </div>

    <!-- All apps in the app store -->
    <div v-show="communityAppStoreId || !appStoreSearchQuery" class="community-app-store-card-columns">
      <card-widget
        v-for="categorizedApps in categorizedAppStore"
        :key="categorizedApps[0].category"
        class="pb-2 card-app-list"
        :header="categorizedApps[0].category"
      >
        <router-link
          :to="{name: communityAppStoreId ? 'community-app-store-app' : 'app-store-app', params: {id: app.id}}"
          v-for="app in categorizedApps"
          :key="app.id"
          class="app-list-app d-flex justify-content-between align-items-center px-3 px-lg-4 py-3"
        >
          <div class="d-flex">
            <div class="d-block">
              <img
                class="app-icon mr-2 mr-lg-3"
                :src="app.icon"
                draggable="false"
              />
            </div>
            <div class="d-flex justify-content-center flex-column">
              <h3 class="app-name text-title-color mb-1">
                {{ app.name }}
              </h3>
              <p class="app-tagline text-muted mb-0">
                {{ app.tagline }}
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
      <card-widget
        class="pb-2 card-app-list umbrel-dev-note mt-2"
        v-if="appStore.length && !communityAppStoreId"
      >
      <div class="px-3 px-lg-4 py-3">
        <span class="rocket ml-3 ml-lg-4">🚀</span>
        <h4 class="font-weight-normal mt-4">Get your app on the Umbrel App Store</h4>
        <p class="text-muted mb-3">
          Use any programming language, database or framework to build your app for Umbrel.
        </p>
        <b-link class="primary-link" href="https://github.com/getumbrel/umbrel-apps/blob/master/README.md" target="_blank">Learn more</b-link>
      </div>
      </card-widget>
    </div>

    <b-modal v-if="appsWithUpdate.length" id="app-updates-modal" body-class="p-0" centered hide-footer>
      <template v-slot:modal-header="{ close }">
        <div class="d-flex flex-column w-100">
          <div class="d-flex justify-content-end w-100">
            <a
              href="#"
              class="align-self-center"
              v-on:click.stop.prevent="close"
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
          <div class="d-flex align-items-center justify-content-between w-100 px-2 px-lg-3">
            <h2 class="mr-auto text-lowercase">Updates</h2>
            <b-button variant="outline-primary" class="px-2" size="sm" @click="updateAll" v-show="canUpdateAll && !isUpdatingAll">Update all</b-button>
          </div>
        </div>
      </template>
      <div class="">
        <div class="app-list-container pb-2 pt-2">
          <update-apps-app
            v-for="app in appsWithUpdate"
            :ref="app.id"
            :key="app.id"
            :app="app"
            class="app-list-app"
            >
          </update-apps-app>
        </div>
      </div>
    </b-modal>

  </div>
</template>

<script>
import { mapState } from "vuex";

import delay from "@/helpers/delay";

import CardWidget from "@/components/CardWidget";
import UpdateAppsApp from "@/views/AppStore/UpdateAppsApp";
import CommunityAppStores from "@/views/AppStore/CommunityAppStores";

export default {
  data() {
    return {
      isTypingAppStoreSearchQuery: false,
      isUpdatingAll: false,
    };
  },
  computed: {
    ...mapState({
      scrollTop: (state) => state.apps.appStoreScrollTop,
      appStore: (state) => state.apps.store,
      appsWithUpdate: (state) => state.apps.installed.filter(app => app.update.version),
      updating: (state) => state.apps.updating,
      appStoreSearchIndex: (state) => state.apps.searchIndex,
      appStoreSearchResults: (state) => state.apps.searchResults,
      communityAppStores: (state) => state.user.communityAppStores,
      communityAppStoreApps: (state) => state.apps.communityAppStoreApps,
    }),
    // for v-model to work with global state
    appStoreSearchQuery: {
      get () {
        return this.$store.state.apps.searchQuery
      },
      set (value) {
        this.$store.dispatch("apps/searchAppStore", value)
      }
    },
    communityAppStoreId: function() {
      return this.$router.currentRoute.params.communityAppStoreId || "";
    },
    communityAppStore: function() {
      return this.communityAppStores.find(({id}) => id === this.communityAppStoreId);
    },
    categorizedAppStore: function () {
      const appStore = this.communityAppStoreId ? this.communityAppStoreApps : this.appStore;
      return appStore.reduce((categories, app) => {
        if (!categories[app.category]) {
          categories[app.category] = [];
        }
        categories[app.category].push(app);
        return categories;
      }, {});
    },
    canUpdateAll: function() {
      return this.updating.length != this.appsWithUpdate.length;
    }
  },
  methods: {
    onScroll: function(event) {
      // update scroll position
      this.$store.dispatch("apps/updateAppStoreScrollTop", event.target.scrollTop);
    },
    onTypeAppStoreSearchQuery: async function() {
      this.isTypingAppStoreSearchQuery = true;
      const appStoreSearchQuery = this.appStoreSearchQuery;
      await delay(500);
      const newAppStoreSearchQuery = this.appStoreSearchQuery;
      if (newAppStoreSearchQuery === appStoreSearchQuery) {
        this.isTypingAppStoreSearchQuery = false;
      }
    },
    updateAll: function() {
      this.isUpdatingAll = true;
      this.appsWithUpdate
      .forEach(app => {
        // Call updateApp() within each UpdateAppsApp component
        // If app is already updating, then updateApp() will return false
        // To avoid a 'double update'
        this.$refs[app.id][0].updateApp();
      });
    },
  },
  created() {
    if (this.communityAppStoreId) {
      this.$store.dispatch("apps/getCommunityAppStoreApps", this.communityAppStoreId);
    } else {
      this.$store.dispatch("apps/getAppStore");
    }

    // https://stackoverflow.com/a/63485725
    this.$nextTick(() => {

      // autofocus search input
      if (!this.communityAppStoreId) {
        this.$refs.searchInput.focus()
      }

      // set previous scroll position
      const container = document.getElementById("content-container");
      if (this.scrollTop) {
        container.scrollTop = this.scrollTop;
      }
      // watch scroll position
      container.addEventListener('scroll', this.onScroll);
    });

  },
  beforeDestroy() {
    const container = document.getElementById("content-container");
    container.removeEventListener('scroll', this.onScroll);
  },
  components: {
    CardWidget,
    UpdateAppsApp,
    CommunityAppStores,
  },
};
</script>

<style lang="scss" scoped>
.app-name {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}
.app-tagline {
  font-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.search-input-container {
  svg.search-input-icon {
    transition: transform 0.3s ease;
    path {
      fill: var(--text-muted-color) !important;
      transition: fill 0.3s ease;
    }
  }
  &.active {
    svg.search-input-icon {
      transform: scale(1.1, 1.1) rotate(-5deg);
      path {
        fill: var(--text-color) !important;
      }
    }
  }
  .search-input {
    width: 100%;
    max-width: 160px;
    background: transparent !important;
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
    color: var(--text-color) !important;
    &::placeholder, &::-webkit-input-placeholder, &::-moz-placeholder, &:-moz-placeholder, &:-ms-input-placeholder {
      color: var(--text-muted-color) !important;
      opacity: 1 !important;
    }
  }
}

.no-search-results-image {
  width: 300px;
  height: auto;
  border-radius: 20px;
}

.umbrel-dev-note {
  position: relative;
  overflow: visible;
  .rocket {
    font-size: 60px;
    position: absolute;
    top: -30px;
    left: 0;
  }
}

#app-updates-modal {
  .app-list-container {
    max-height: 440px;
    overflow-y: auto;
  }
}

.updates-badge {
    position: absolute;
    top: -8px;
    right: -12px;
    height: 26px;
    width: 26px;
    background: #FF4E4E;
    border-radius: 13px;
    -webkit-box-shadow: -4px 4px 4px rgb(0 0 0 / 10%);
    box-shadow: -4px 4px 4px rgb(0 0 0 / 10%);
    font-size: 15px;
    line-height: 25px;
    margin: 0;
}

// transitions

.no-search-results-transition-enter-active,
.no-search-results-transition-leave-active {
  transition: transform 0.5s ease;
  transition-delay: 1.5s;
}
.no-search-results-transition-enter {
  transform: rotate(-360deg) scale3d(0, 0, 0);
  opacity: 0;
}
.no-search-results-transition-enter-to {
  transform: rotate(0deg) scale3d(1, 1, 1);
  opacity: 1;
}
</style>
