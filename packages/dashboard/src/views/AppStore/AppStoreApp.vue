<template>
  <div v-if="app" class="">
    <div class="mt-3 mb-1 mb-sm-3 pb-lg-2">
      <a
        href="#"
        @click.prevent="goBack"
        class="card-link primary-link d-inline-block mb-3 mb-sm-4"
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
        <small class="text-uppercase">Back</small></a
      >
      <div
        class="d-flex flex-column flex-sm-row justify-content-between align-items-center"
      >
        <!-- Optimized for Umbrel Home badge for mobile  -->
        <optimized-for-umbrel-home-badge v-if="app.optimizedForUmbrelHome" class="d-sm-none mb-1" />

        <div class="d-flex w-xs-100 justify-content-start pr-2 mb-2 mb-sm-0">
          <div class="d-block">
            <img
              class="app-icon app-icon-lg mr-2 mr-sm-3 align-self-top"
              :src="`${app.icon}`"
              draggable="false"
            />
          </div>
          <div>
            <!-- Optimized for Umbrel Home badge for > mobile  -->
            <optimized-for-umbrel-home-badge v-if="app.optimizedForUmbrelHome" class="d-none d-sm-inline-block" />

            <h3 class="d-block app-name mt-sm-1 mb-0 mb-sm-1">
              {{ app.name }}
            </h3>
            <p class="text-muted mb-2" style="line-height: 1.3; font-size: 90%;">{{ app.tagline }}</p>
            <p class="d-none d-sm-block">
              <small>{{ app.developer }}</small>
            </p>
          </div>
        </div>
        <div
          class="w-xs-100 d-flex flex-column align-items-sm-center mt-1 mt-xm-0"
          v-if="isInstalled && !isUninstalling"
        >
          <b-button
            v-if="isOffline"
            variant="success"
            class="px-4 fade-in-out cursor-wait"
            disabled
            pill
            >Starting...</b-button
          >
          <b-button
            v-else
            variant="primary"
            class="px-4"
            :href="url"
            target="_blank"
            v-on:click="openApp($event)"
            pill
            >Open</b-button
          >
          <div class="mt-2 text-center d-flex justify-content-center" v-if="installedApp.defaultPassword">
            <div class="text-left mr-2" v-if="installedApp.defaultUsername">
              <small class="text-muted">Default app username</small>
              <input-copy
                width="140px"
                size="sm"
                :value="installedApp.defaultUsername"
                class="mt-1"
              ></input-copy>
            </div>
            <div :class="installedApp.defaultUsername ? 'text-left': ''">
              <small class="text-muted">Default app password</small>
              <input-copy
                :width="installedApp.defaultUsername ? '140px' : 'auto'"
                size="sm"
                :value="installedApp.defaultPassword"
                class="mt-1"
              ></input-copy>
            </div>
          </div>
          <!-- spacer on mobile -->
          <div class="p-1 p-sm-0"></div>
        </div>
        <div class="d-flex flex-column align-items-sm-center w-xs-100" v-else>
          <b-button
            v-if="isInstalling"
            variant="success"
            class="px-4 fade-in-out cursor-wait"
            disabled
            pill
            >Installing...</b-button
          >
          <b-button
            v-else-if="isUninstalling"
            variant="warning"
            class="px-4 fade-in-out cursor-wait"
            disabled
            pill
            >Uninstalling...</b-button
          >
          <b-button
            v-else-if="communityAppStoreId"
            variant="primary"
            class="px-4"
            v-b-modal.community-app-store-warning-modal
            pill
            >Install</b-button
          >
          <b-button
            v-else
            variant="success"
            class="px-4"
            @click="installApp({confirmedPermissions: false})"
            pill
            >Install</b-button
          >
          <small
            :style="{ opacity: isInstalling || isUninstalling ? 1 : 0 }"
            class="mt-1 d-block text-muted text-center"
            >This may take a few minutes</small
          >
          <div class="mt-2 text-center d-flex justify-content-center" v-if="isInstalling && app.defaultPassword">
            <div class="text-left mr-2" v-if="app.defaultUsername">
              <small class="text-muted">Default app username</small>
              <input-copy
                width="140px"
                size="sm"
                :value="app.defaultUsername"
                class="mt-1"
              ></input-copy>
            </div>
            <div :class="app.defaultUsername ? 'text-left': ''">
              <small class="text-muted">Default app password</small>
              <input-copy
                :width="app.defaultUsername ? '140px' : 'auto'"
                size="sm"
                :value="app.defaultPassword"
                class="mt-1"
              ></input-copy>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="app-gallery pt-1 pb-3 pt-sm-3 pb-sm-4 mb-2 mb-sm-3 px-1 px-sm-4" v-dragscroll>
      <app-store-app-gallery-image
        v-for="(image, index) in app.gallery"
        :key="`${image}${index}`"
        :preloaderImage="app.icon"
        :galleryImage="image"
      />
      <div class="d-block" style="padding: 1px"></div>
    </div>
    <b-row>
      <b-col col cols="12" md="7" lg="8">
        <card-widget header="About this app">
          <div class="px-3 px-lg-4 pb-4">
            <p class="text-newlines">{{ app.description }}</p>
            <!-- <div v-if="app.releaseNotes" class="release-notes-container mt-4 pt-3">
              <h3 class="mb-1">What's new</h3>
              <span class="text-muted d-block mb-3">Version {{ app.version }}</span>
              <release-notes :text="app.releaseNotes" />
            </div> -->
          </div>
        </card-widget>
      </b-col>
      <b-col col cols="12" md="5" lg="4">
        <card-widget header="Information">
          <div class="px-3 px-lg-4 pb-4">
            <div class="d-flex justify-content-between mb-3">
              <span class="text-muted">Version</span>
              <span>{{ app.version }}</span>
            </div>
            <div class="d-flex justify-content-between mb-3">
              <span class="text-muted">Source Code</span>
              <a v-if="app.repo" class="primary-link" :href="app.repo" target="_blank">Public</a>
              <span v-else>Private</span>
            </div>
            <div class="d-flex justify-content-between mb-3">
              <span class="text-muted">Developer</span>
              <a class="primary-link" :href="app.website" target="_blank">{{ app.developer }}</a>
            </div>
            <div v-if="app.submitter && app.submission" class="d-flex justify-content-between mb-3">
              <span class="text-muted">Submitted by</span>
              <a class="primary-link" :href="app.submission" target="_blank">{{ app.submitter }}</a>
            </div>
            <div class="d-flex justify-content-between mb-3">
              <span class="text-muted">Compatibility</span>
              <span>Compatible</span>
            </div>
            <div class="mb-4" v-if="appDependencies.length">
              <span class="d-block text-muted mb-3">Requires</span>
              <div
                class="d-flex align-items-center justify-content-between mb-3"
                v-for="dependency in appDependencies"
                :key="dependency.id"
              >
                <div class="d-flex align-items-center">
                  <img
                    :src="`https://getumbrel.github.io/umbrel-apps-gallery/${dependency.id}/icon.svg`"
                    class="mr-2 app-icon app-icon-xs"
                  />
                  <span class="">{{ dependency.name }}</span>
                </div>
                <div v-if="dependency.isInstalled">
                  <svg
                    width="30"
                    height="30"
                    viewBox="0 0 30 30"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M19.3035 10.7643C19.5718 10.4486 20.0451 10.4103 20.3607 10.6785C20.6763 10.9468 20.7147 11.4201 20.4464 11.7357L14.0714 19.2357C13.799 19.5563 13.3162 19.5901 13.0017 19.3105L9.62671 16.3105C9.31712 16.0354 9.28924 15.5613 9.56443 15.2517C9.83962 14.9421 10.3137 14.9142 10.6233 15.1894L13.4251 17.68L19.3035 10.7643Z"
                      fill="#00CD98"
                    />
                  </svg>
                  <small class="text-success">Installed</small>
                </div>
                <router-link v-else :to="{name: 'app-store-app', params: {id: dependency.id}}" class="primary-link">
                  <small class="text-uppercase">Install</small>
                  <svg class="ml-1" width="6" height="12" viewBox="0 0 6 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0.219671 9.78411C-0.0732236 10.0949 -0.0732236 10.5989 0.219671 10.9097C0.512565 11.2205 0.987439 11.2205 1.28033 10.9097L5.78033 6.13423C6.06426 5.83291 6.0742 5.34773 5.80287 5.03361L1.67787 0.258101C1.39798 -0.0659324 0.923548 -0.087822 0.618208 0.209209C0.312868 0.50624 0.292245 1.00971 0.572136 1.33374L4.2119 5.54749L0.219671 9.78411Z" fill="#C3C6D1"/>
                  </svg>
                </router-link>
              </div>
            </div>
            <b-link
              :href="app.support"
              target="_blank"
              size="sm"
              class="primary-link d-inline-block mb-1"
              block
              >Get support</b-link
            >
          </div>
        </card-widget>
      </b-col>
    </b-row>

    <card-widget v-if="app.releaseNotes" header="What's new">
      <div class="px-3 px-lg-4 pb-4">
        <h3 class="mb-1">Version {{ app.version }}</h3>
        <release-notes :text="app.releaseNotes" />
      </div>
    </card-widget>

    <app-store-apps-card
      :apps="similarApps"
      title="You might also like"
      class="pb-2"
    ></app-store-apps-card>

    <b-modal v-if="communityAppStoreId" id="community-app-store-warning-modal" body-class="" size="sm" centered hide-footer>
      <template v-slot:modal-header="{ close }">
        <div class="pt-2 d-flex justify-content-between w-100 px-2">
          <span class="font-weight-bold mb-0">&#9888;&#65039; Warning</span>
          
          <!-- Emulate built in modal header close button action -->
          <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
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
      <div class="px-2">
        <p>{{ app.name }} is an app published in a Community App Store called "{{ communityAppStore.name }}".
          <br/><br/>
          <span class="font-weight-bold">Apps in Community App Stores are not verified or vetted by the official Umbrel App Store team, and can potentially be insecure or malicious.</span>
          <br/><br/>
        </p>
      </div>
        
      <div class="px-2 pb-2">
        <b-button
          variant="danger"
          block
          @click="installApp({confirmedPermissions: false})"
        >
          I understand, continue
        </b-button>
      </div>
    </b-modal>

    <b-modal v-if="appDependencies.length" id="app-dependencies-modal" body-class="" size="sm" centered hide-footer>
      <template v-slot:modal-header="{ close }">
        <div class="pt-2 d-flex justify-content-between w-100 px-2">
          <span class="font-weight-bol mb-0">{{ app.name }} requires access to</span>
          
          <!-- Emulate built in modal header close button action -->
          <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
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
      <div class="px-2 pb-2">
        <div
          class="d-flex align-items-center justify-content-between mb-3"
          v-for="dependency in appDependencies"
          :key="dependency.id"
        >
          <div class="d-flex align-items-center">
            <img
              :src="`https://getumbrel.github.io/umbrel-apps-gallery/${dependency.id}/icon.svg`"
              class="mr-2 app-icon app-icon-xs"
            />
            <span class="">{{
              dependency.name
            }}</span>
          </div>
          <div v-if="dependency.isInstalled">
            <svg
              width="30"
              height="30"
              viewBox="0 0 30 30"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M19.3035 10.7643C19.5718 10.4486 20.0451 10.4103 20.3607 10.6785C20.6763 10.9468 20.7147 11.4201 20.4464 11.7357L14.0714 19.2357C13.799 19.5563 13.3162 19.5901 13.0017 19.3105L9.62671 16.3105C9.31712 16.0354 9.28924 15.5613 9.56443 15.2517C9.83962 14.9421 10.3137 14.9142 10.6233 15.1894L13.4251 17.68L19.3035 10.7643Z"
                fill="#00CD98"
              />
            </svg>
            <small class="text-success">Installed</small>
          </div>
          <router-link v-else :to="{name: 'app-store-app', params: {id: dependency.id}}" class="primary-link">
            <small class="text-uppercase">Install</small>
            <svg class="ml-1" width="6" height="12" viewBox="0 0 6 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0.219671 9.78411C-0.0732236 10.0949 -0.0732236 10.5989 0.219671 10.9097C0.512565 11.2205 0.987439 11.2205 1.28033 10.9097L5.78033 6.13423C6.06426 5.83291 6.0742 5.34773 5.80287 5.03361L1.67787 0.258101C1.39798 -0.0659324 0.923548 -0.087822 0.618208 0.209209C0.312868 0.50624 0.292245 1.00971 0.572136 1.33374L4.2119 5.54749L0.219671 9.78411Z" fill="#C3C6D1"/>
            </svg>
          </router-link>
        </div>
      </div>
        
      <div class="px-2 pb-2">
        <b-button
          variant="success"
          block
          @click="installApp({confirmedPermissions: true})"
          :disabled="!areAllAppDependenciesInstalled"
        >
          Continue
        </b-button>
        <small v-if="!areAllAppDependenciesInstalled" class="d-block text-muted mt-2">Install {{appDependencies.length > 1 ? 'the above apps' : appDependencies[0]['name']}} first to install {{ app.name }}</small>
      </div>
      <div class=""/>
    </b-modal>
  </div>
</template>

<script>
import { mapState } from "vuex";
import { dragscroll } from 'vue-dragscroll';

import delay from "@/helpers/delay";

import CardWidget from "@/components/CardWidget";
import InputCopy from "@/components/Utility/InputCopy";
import AppStoreAppGalleryImage from "@/views/AppStore/AppStoreAppGalleryImage";
import ReleaseNotes from "@/views/AppStore/ReleaseNotes";
import AppStoreAppsCard from "@/views/AppStore/AppStoreAppsCard";
import OptimizedForUmbrelHomeBadge from "@/views/AppStore/OptimizedForUmbrelHomeBadge";

export default {
  directives: {
    dragscroll
  },
  data() {
    return {
      isOffline: false,
      checkIfAppIsOffline: true
    };
  },
  computed: {
    ...mapState({
      installedApps: (state) => state.apps.installed,
      appStore: (state) => state.apps.store,
      installing: (state) => state.apps.installing,
      uninstalling: (state) => state.apps.uninstalling,
      communityAppStores: (state) => state.user.communityAppStores,
      communityAppStoreApps: (state) => state.apps.communityAppStoreApps,
    }),
    similarApps: function () {
      // Returns the list of 6 random apps from an app's category
      return this.appStore
            .filter((app) => app.category === this.app.category && app.id !== this.app.id)
            .sort(() => Math.random() - 0.5)
            .slice(0, 6);
    },
    communityAppStoreId: function() {
      return this.$router.currentRoute.params.communityAppStoreId || "";
    },
    communityAppStore: function() {
      return this.communityAppStores.find(({id}) => id === this.communityAppStoreId);
    },
    app: function () {
      const appStore = this.communityAppStoreId ? this.communityAppStoreApps : this.appStore;
      return appStore.find((app) => app.id === this.$route.params.id);
    },
    installedApp: function () {
      return this.installedApps.find((app) => app.id === this.$route.params.id);
    },
    isInstalled: function () {
      const installedAppIndex = this.installedApps.findIndex(
        (app) => app.id === this.app.id
      );
      return installedAppIndex !== -1;
    },
    isInstalling: function () {
      const index = this.installing.findIndex((appId) => appId === this.app.id);
      return index !== -1;
    },
    isUninstalling: function () {
      const index = this.uninstalling.findIndex(
        (appId) => appId === this.app.id
      );
      return index !== -1;
    },
    url: function () {
      if (window.location.origin.indexOf(".onion") > 0) {
        const installedApp = this.installedApps.find(
          (app) => app.id === this.app.id
        );
        return `http://${installedApp.hiddenService}${this.app.path}`;
      } else {
        if (this.app.torOnly) {
          return "#";
        }
        return `http://${window.location.hostname}:${this.app.port}${this.app.path}`;
      }
    },
    appDependencies() {

      if (!this.app.dependencies) {
        return [];
      }

      return this.app.dependencies.map(id => ({
        ...this.appStore.find(app => app.id === id),
        isInstalled: this.installedApps.some(app => app.id === id),
      }));
    },
    areAllAppDependenciesInstalled() {
      return this.appDependencies.every(dependency => dependency.isInstalled);
    }
  },
  methods: {
    goBack() {
      return this.$router.back();
    },
    async installApp({confirmedPermissions = false}) {
      if (this.communityAppStoreId) {
        this.$bvModal.hide('community-app-store-warning-modal');
      }

      if (this.appDependencies.length) {
        if (!confirmedPermissions) {
          return this.$bvModal.show('app-dependencies-modal');
        }
        this.$bvModal.hide('app-dependencies-modal');
      }

      try {
        await this.$store.dispatch("apps/install", this.app.id);
        this.isOffline = true;
        this.pollOfflineApp();
      } catch (error) {
        if (error.response && error.response.data) {
          return this.$bvToast.toast(error.response.data, {
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
      if (this.app.torOnly && window.location.origin.indexOf(".onion") < 0) {
        event.preventDefault();
        alert(`${this.app.name} can only be used over Tor. Please access your Umbrel in a Tor browser on your remote access URL (Settings > Account > Remote access) to open this app.`);
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
  async created() {
    if (this.communityAppStoreId) {
      await this.$store.dispatch("apps/getCommunityAppStoreApps", this.communityAppStoreId);
    } else {
      await this.$store.dispatch("apps/getAppStore");
    }
    if (this.isInstalled) {
      this.pollOfflineApp();
    }
  },
  beforeDestroy() {
    this.checkIfAppIsOffline = false;
  },
  components: {
    CardWidget,
    InputCopy,
    AppStoreAppGalleryImage,
    ReleaseNotes,
    AppStoreAppsCard,
    OptimizedForUmbrelHomeBadge,
  },
};
</script>

<style lang="scss" scoped>
.app-name {
  font-weight: 600;
}
.release-notes-container {
  border-top: solid 1px var(--app-store-app-border-color);
}
</style>
