<template>
  <div class="pt-2">
    <div class="mt-3">
      <div class="">
        <!--Header -->
        <div class="d-md-flex justify-content-between align-items-center mb-3 mb-md-4">
          <div class="mb-3 mb-md-0">
            <h1 class="text-lowercase mb-1">App Store</h1>
            <p class="text-muted mb-0">Add super powers to your Umbrel with amazing self-hosted applications</p>
          </div>

          <div class="d-flex">

            <!-- Search  -->
            <div class="search-input-container d-flex align-items-center"
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
                placeholder="Search"
                autocomplete="off"
                v-model="appStoreSearchQuery"
                @input="onTypeAppStoreSearchQuery"
              ></b-input>
              <b-button
                class="btn-clear-search"
                @click="clearSearchQuery"
                :class="{'invisible': !appStoreSearchQuery}"
              >
                <svg class="" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M3.41421 0.585786C2.63316 -0.195262 1.36684 -0.195262 0.585786 0.585786C-0.195262 1.36684 -0.195262 2.63316 0.585786 3.41421L5.96528 8.7937L0.585872 14.1731C-0.195177 14.9542 -0.195177 16.2205 0.585872 17.0015C1.36692 17.7826 2.63325 17.7826 3.4143 17.0015L8.7937 11.6221L14.1731 17.0015C14.9542 17.7826 16.2205 17.7826 17.0015 17.0015C17.7826 16.2205 17.7826 14.9542 17.0015 14.1731L11.6221 8.7937L17.0016 3.41421C17.7827 2.63316 17.7827 1.36684 17.0016 0.585786C16.2206 -0.195262 14.9542 -0.195262 14.1732 0.585786L8.7937 5.96528L3.41421 0.585786Z" fill="white" fill-opacity="1"/>
                </svg>
              </b-button>
            </div>

            <!-- Updates button  -->
            <div class="position-relative mr-3 ml-auto ml-md-0" v-if="appsWithUpdate.length && !communityAppStoreId">
              <b-button pill variant="primary" class="px-3" v-b-modal.app-updates-modal>
                {{ `Update${appsWithUpdate.length > 1 ? 's' : ''}` }}
              </b-button>
              <transition name="grow-transition" appear>
                <span class="updates-badge text-white text-center mr-1">{{ appsWithUpdate.length }}</span>
              </transition>
            </div>

            <!-- Menu  -->
            <b-dropdown
              v-if="!communityAppStoreId"
              variant="link"
              toggle-class="text-decoration-none p-0"
              no-caret
              right
              :class="{'ml-auto ml-md-0': !appsWithUpdate.length}"
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

            <!-- Community App Stores Modal  -->
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

    <b-tabs v-if="!appStoreSearchQuery" @activate-tab="onTabChange" :value="appStoreActiveTabIndex" class="app-store-tabs" pills>

      <!-- Discover tab  -->
      <b-tab title-link-class="btn-app-store-tab mr-2" title="Discover">

        <!-- Banners  -->
        <div v-if="appStoreDiscoverBanners.length" class="overwrite-banner-gallery app-gallery pt-1 pb-3 pt-sm-3 pb-sm-4 mb-2 px-1 px-sm-4" v-dragscroll>
          <!-- Include banners only for apps that exist locally -->
          <router-link
            v-for='app in appStoreDiscoverBanners.filter((bannerApp) => appStore.some((appStoreApp) => bannerApp.id === appStoreApp.id))'
            :key="`${app.id}`"
            :to="{name: 'app-store-app', params: {id: app.id}}"
          >
            <app-store-app-gallery-image
              :preloaderImage="`https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/icon.svg`"
              :galleryImage="app.image"
            />
          </router-link>
          <div class="d-block" style="padding: 1px"></div>
        </div>

        <div v-else>
          <div class="overwrite-banner-gallery app-gallery pt-1 pb-3 pt-sm-3 pb-sm-4 mb-2 px-1 px-sm-4" v-dragscroll>
            <app-store-app-gallery-image :preloaderImage="require('@/assets/dock/home.png')"/>
            <app-store-app-gallery-image :preloaderImage="require('@/assets/dock/home.png')"/>
            <app-store-app-gallery-image :preloaderImage="require('@/assets/dock/home.png')"/>
            <div class="d-block" style="padding: 1px"></div>
          </div>
        </div>

        <div v-if="appStoreDiscoverSections.length">
          <div v-for="(section, index) in appStoreDiscoverSections" :key="`${section.type}-${index}`">
            <app-store-apps-card
              v-if="section.type === 'list'"
              :apps="getAppObjectsFromAppIds(section.apps)"
              :title="section.heading"
              :subtitle="section.subheading"
              class="pb-2"
            ></app-store-apps-card>
          </div>
        </div>
      </b-tab>

      <b-tab lazy title-link-class="btn-app-store-tab mr-2" title="All apps">
        <app-store-apps-card
          :apps="appStore"
          title="All apps"
          class="pb-2 pt-3"
        ></app-store-apps-card>
      </b-tab>

      <b-tab
        v-for="category in appStoreCategories"
        :key="category.id"
        lazy
        title-link-class="btn-app-store-tab mr-2"
        :title="category.name"
      >
        <app-store-apps-card
          :apps="categorizedAppStore[category.id]"
          :title="category.name"
          class="pb-2 pt-3"
        ></app-store-apps-card>
      </b-tab>
    </b-tabs>

    <!-- Search results  -->
    <app-store-apps-card v-else-if="appStoreSearchQuery && appStoreSearchResults.length"
      :apps="appStoreSearchResults"
      :title="`Search results for '${appStoreSearchQuery}'`"
      class="pb-2 pt-3"
    ></app-store-apps-card>

    <!-- No results found -->
    <div v-else-if="!communityAppStoreId && appStoreSearchQuery && !appStoreSearchResults.length && !isTypingAppStoreSearchQuery" class="w-100">
      <p class="text-muted">No results found</p>
      <transition name="no-search-results-transition" appear>
        <img class="no-search-results-image d-block mt-5 mx-auto" src="@/assets/no-search-results.gif" />
      </transition>
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
import { dragscroll } from 'vue-dragscroll';

import delay from "@/helpers/delay";

import UpdateAppsApp from "@/views/AppStore/UpdateAppsApp";
import CommunityAppStores from "@/views/AppStore/CommunityAppStores";
import AppStoreAppsCard from "@/views/AppStore/AppStoreAppsCard";
import AppStoreAppGalleryImage from "@/views/AppStore/AppStoreAppGalleryImage";

export default {
  directives: {
    dragscroll
  },
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
      appStoreActiveTabIndex: (state) => state.apps.appStoreActiveTabIndex,
      communityAppStores: (state) => state.user.communityAppStores,
      communityAppStoreApps: (state) => state.apps.communityAppStoreApps,
      appStoreDiscoverBanners: (state) => state.apps.appStoreDiscoverData.banners,
      appStoreDiscoverSections: (state) => state.apps.appStoreDiscoverData.sections,
    }),
    appStoreCategories: function() {
      const categoriesInLocalAppStore = Object.keys(this.categorizedAppStore);
      const categories = [
        {
          id: 'files',
          name: 'Files & Productivity',
        },
        {
          id: 'bitcoin',
          name: 'Bitcoin',
        },
        {
          id: 'finance',
          name: 'Finance',
        },
        {
          id: 'media',
          name: 'Media',
        },
        {
          id: 'networking',
          name: 'Networking',
        },
        {
          id: 'social',
          name: 'Social',
        },
        {
          id: 'automation',
          name: 'Home & Automation',
        },
        {
          id: 'ai',
          name: 'AI',
        },
        {
          id: 'developer',
          name: 'Developer Tools',
        },
      ];
      for (let category of categoriesInLocalAppStore) {
        if (!categories.find(({id}) => id === category)) {
          categories.push({
            id: category,
            name: category.charAt(0).toUpperCase() + category.slice(1),
          });
        }
      }
      return categories;
    },
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
    onTabChange: function(newTabIndex) {
      this.$store.dispatch("apps/updateAppStoreActiveTabIndex", newTabIndex);
    },
    getAppObjectsFromAppIds: function(appIds) {
      const apps = [];
      for (const appId of appIds) {
        const app = this.appStore.find(app => app.id === appId);
        if (app) apps.push(app);
      }
      return apps;
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
    clearSearchQuery: function() {
      this.isTypingAppStoreSearchQuery = false;
      this.$store.dispatch("apps/searchAppStore", "");
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
      this.$store.dispatch("apps/getAppStoreDiscoverData");
    }

    // https://stackoverflow.com/a/63485725
    this.$nextTick(() => {

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
    UpdateAppsApp,
    CommunityAppStores,
    AppStoreAppsCard,
    AppStoreAppGalleryImage,
  },
};
</script>

<style lang="scss">
.app-store-tabs {
  .nav {
    margin-left: -1.5rem;
    margin-right: -1.5rem;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding: 0 1rem 1rem 1rem;
    // hide scrollbar
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }
  .nav-item {
    flex-shrink: 0;
  }
  .nav-tabs {
    border-bottom: none !important;
  }
  .nav-pills .nav-link {
    border-radius: 2rem;
  }
  .nav-pills .nav-link.active, .nav-pills .show > .nav-link {
    background-color: var(--glass-button-background-color);
    color: var(--text-color);
  }
}
</style>

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
    max-width: 90px;
    background: transparent !important;
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
    color: var(--text-color) !important;
    &::placeholder, &::-webkit-input-placeholder, &::-moz-placeholder, &:-moz-placeholder, &:-ms-input-placeholder {
      color: var(--text-muted-color) !important;
      opacity: 1 !important;
    }
    padding-right: 8px;
  }
  .btn-clear-search {
    // position: absolute;
    top: 10px;
    right: 10px;
    height: 20px;
    width: 20px;
    padding: 0;
    background-color: var(--content-close-button-background-color);
    backdrop-filter: blur(10px);
    border-radius: 100%;
    transition: transform 0.4s, opacity 0.4s ease;
    margin-right: 10px;
    svg {
      position: absolute;
      top: 50%;
      left: 50%;
      height: 7px;
      width: 7px;
      transform: translate3d(-50%, -50%, 0);
    }
    &:hover {
      transform: scale3d(1.05, 1.05, 1.05);
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
