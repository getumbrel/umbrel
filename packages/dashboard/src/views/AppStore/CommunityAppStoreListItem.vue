<template>
  <div class="py-2 px-sm-1">
    <div class="d-flex justify-content-between align-items-center">
      <div class="pr-2">
        <span class="d-block">{{ name }}</span>
      </div>
      <div class="d-flex">
        <b-button size="sm" variant="outline-primary" @click="open" :disabled="isOpening || isRemoving">
          {{ isOpening ? 'Opening...' : 'Open' }}
        </b-button>
        <b-button size="sm" variant="outline-danger" @click="remove" :disabled="isRemoving || isOpening">
          {{ isRemoving ? 'Removing...' : 'Remove' }}
        </b-button>
      </div>
    </div>

    <!-- Community app store URL -->
    <input-copy
      :width="'100%'"
      size="sm"
      :value="url"
      class="mt-2"
    ></input-copy>
  </div>
</template>

<script>
import { mapState } from "vuex";

import delay from "@/helpers/delay";
import API from "@/helpers/api";

import InputCopy from "@/components/Utility/InputCopy";

export default {
  props: {
    name: String,
    id: String,
    url: String,
  },
  data() {
    return {
      isOpening: false,
      isRemoving: false
    };
  },
  computed: {
    ...mapState({
      communityAppStores: (state) => state.user.communityAppStores
    })
  },
  methods: {
    async open() {
      this.isOpening = true;
      // load app store first as there could be old data in
      // the state from another community app store before
      await this.$store.dispatch("apps/getCommunityAppStoreApps", this.id);
      this.isOpening = false;
      // navigate to the community app store
      this.$router.push({name: 'community-app-store', params: {communityAppStoreId: this.id}})
    },
    async remove() {
       try {
        this.isRemoving = true;
        const payload = {
          url: this.url,
        };
        await API.post(
          `${process.env.VUE_APP_MANAGER_API_URL}/v1/community-app-stores/remove`,
          payload
        );
        // poll until app store is removed
        this.pollForRemoval();
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
    async pollForRemoval() {
      // poll every second until the app store is removed
      while (this.isRemoving) {
        try {
          await this.$store.dispatch("user/getInfo");
          const communityAppStore = this.communityAppStores.find((appStore) => appStore.url === this.url);
          // if no app store found = it's removed
          if (!communityAppStore) {
            this.isRemoving = false;
            this.$bvToast.toast(`Removed "${this.name}" Community App Store from your Umbrel.`, {
              title: "Community App Store Removed",
              autoHideDelay: 3000,
              variant: "success",
              solid: true,
              toaster: "b-toaster-bottom-right",
            });
            return this.$store.dispatch("apps/getInstalledApps");
          }
        } catch (error) {
          this.isRemoving = false;
          throw error;
        }
        await delay(1000);
      }
    },
  },
  components: {
    InputCopy,
  },
};
</script>

