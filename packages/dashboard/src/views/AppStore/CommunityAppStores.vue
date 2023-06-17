<template>
  <div class="px-2 px-lg-3 pb-4 mt-2">

    <!-- Intro text -->
    <p class="text-muted">
      Community App Stores allow you to install apps on your Umbrel that may not be available in the official Umbrel App Store. They also make it easy to test beta versions of Umbrel apps, then provide valuable feedback to developers before they release their apps on the official Umbrel App Store.
    </p>
    <div class="mt-2 mb-3">
      <b-link class="primary-link" href="https://github.com/getumbrel/umbrel-community-app-store" target="_blank">Learn more</b-link>
    </div>

    <!-- Warning  -->
    <b-alert variant="warning" show class="mb-4">
      <small>Community App Stores can be created by anyone. The apps published in them are not verified or vetted by the official Umbrel App Store team, and can potentially be insecure or malicious. Use caution and only add app stores from developers you trust.</small>
    </b-alert>

    <!-- Form to add a community app store  -->
    <b-form @submit="addCommunityAppStore" class="d-flex">
      <label class="sr-only" for="community-app-store-url">URL</label>
      <b-form-input
        v-model="communityAppStoreUrl"
        id="community-app-store-url"
        class="mb-0 mr-2 neu-input"
        placeholder="URL"
        :disabled="isAddingCommunityAppStore"
      ></b-form-input>
      <b-button
        type="submit"
        :disabled="isAddingCommunityAppStore"
        variant="primary"
      >
        {{ isAddingCommunityAppStore ? 'Adding...' : 'Add' }}
      </b-button>
    </b-form>

    <!-- Display existing community app stores  -->
    <div v-if="communityAppStores.length" class="community-app-stores-list-container py-sm-2 mt-3">
      <b-list-group>
        <b-list-group-item 
          v-for="appStore in communityAppStores"
          :key="appStore.url"
          class="community-app-store-list-item"
          >
          <community-app-store-list-item
            :id="appStore.id"
            :name="appStore.name"
            :url="appStore.url"
          />
        </b-list-group-item>
      </b-list-group>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";
import delay from "@/helpers/delay";
import API from "@/helpers/api";
import CommunityAppStoreListItem from '@/views/AppStore/CommunityAppStoreListItem';

export default {
  data() {
    return {
      communityAppStoreUrl: "",
      isAddingCommunityAppStore: false
    };
  },
  computed: {
    ...mapState({
      communityAppStores: (state) => state.user.communityAppStores,
    }),
  },
  methods: {
    async addCommunityAppStore(event) {
      event.preventDefault();
       try {
        this.isAddingCommunityAppStore = true;

        const payload = {
          url: this.communityAppStoreUrl,
        };
        const { data: { url } } = await API.post(
          `${process.env.VUE_APP_MANAGER_API_URL}/v1/community-app-stores/add`,
          payload
        );
        // poll for to check when app store is succesfully added
        this.pollForNewCommunityAppStore(url);
      } catch (error) {
        this.isAddingCommunityAppStore = false;
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
    async pollForNewCommunityAppStore(url) {
      // keep polling every second until the app store is added 
      while (this.isAddingCommunityAppStore) {
        try {
          await this.$store.dispatch("user/getInfo");
          const communityAppStore = this.communityAppStores.find((appStore) => appStore.url === url);
          if (communityAppStore) {
            this.isAddingCommunityAppStore = false;
            // reset input URL field
            this.communityAppStoreUrl = '';
            this.$bvToast.toast(`Added "${communityAppStore.name}" Community App Store to your Umbrel.`, {
              title: "Community App Store Added",
              autoHideDelay: 3000,
              variant: "success",
              solid: true,
              toaster: "b-toaster-bottom-right",
            });
            return this.$store.dispatch("apps/getInstalledApps");
          }
        } catch (error) {
          this.isAddingCommunityAppStore = false;
          throw error;
        }
        await delay(1000);
      }
    },
  },
  components: {
    CommunityAppStoreListItem,
  },
};
</script>
<style lang="scss" scoped>
.community-app-stores-list-container {
  background: var(--community-app-stores-list-container-background-color);
  border-radius: 1rem;
  .list-group {
    .list-group-item {
      background: transparent;
      border-bottom: solid 1px rgba(125, 125, 125, 0.1);
      &:last-child {
        border-color: transparent;
      }
    }
  }
}
</style>
