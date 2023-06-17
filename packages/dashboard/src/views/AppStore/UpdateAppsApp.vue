<template>
  <transition name="app-updated-transition" appear>
    <div class="py-3 px-3 px-lg-4">
      <div class="d-flex w-100 justify-content-between align-items-center">
        <div class="d-flex align-items-center">
          <div class="app-icon-container mr-2 mr-lg-2">
            <img
              class="app-icon"
              :src="app.icon"
            />
          </div>
          <div class="d-flex flex-column">
            <h4 class="app-name text-title-color mb-1 pr-1">
              {{ app.name }}
            </h4>
            <span class="text-muted mb-0">
              Version {{ app.update.version }}
            </span>
          </div>
        </div>
        <div class="position-relative">
          <div class="btn-update-container">
            <b-button 
              variant="success"
              size="sm"
              @click="updateApp()"
              class="px-2 btn-update"
              :class="{ 'fade-in-out': isUpdating }"
              :disabled="isUpdating"
            >{{ isUpdating ? "Updating..." : "Update" }}</b-button>
          </div>
          <span class="text-updated w-100 d-flex align-items-center justify-content-end">
            <b-icon icon="check-circle-fill" variant="success"></b-icon>
            <small class="ml-1">Updated</small>
          </span>
        </div>
      </div>
      <release-notes v-if="app.update.releaseNotes" :text="app.update.releaseNotes" />
    </div>
  </transition>
</template>



<script>
import { mapState } from "vuex";
import ReleaseNotes from "@/views/AppStore/ReleaseNotes";

export default {
  props: {
    app: Object
  },
  data() {
    return {};
  },
  computed: {
    ...mapState({
      updating: (state) => state.apps.updating,
    }),
    isUpdating: function() {
      return this.updating.includes(this.app.id);
    }
  },
  methods: {
    updateApp: async function() {
      if(this.isUpdating) return false;

      try {
        await this.$store.dispatch("apps/update", this.app.id);
      } catch(error) {
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
    }
  },
  components: {
    ReleaseNotes,
  }
};
</script>

<style lang="scss" scoped>
.text-updated {
  position: absolute;
  bottom: 0;
  left: 0;
  opacity: 1;
  visibility: hidden;
}

.app-updated-transition-leave-active {
  transition: opacity 0.3s ease;
  transition-delay: 5s;
  opacity: 1;
  .text-updated {
    transition: transform 0.3s, opacity 0.3s ease;
    visibility: visible;
  }
  .btn-update-container {
    transition: transform 0.3s, opacity 0.3s ease;
  }
}
.app-updated-transition-leave {
  opacity: 1;
  .text-updated {
    transform: translate3d(0, 0, 0);
    opacity: 0;
  }
  .btn-update-container {
    transform: translate3d(0, 0, 0);
  }
}
.app-updated-transition-leave-to {
  opacity: 0;
  .text-updated {
    transform: translate3d(0, -50%, 0);
    opacity: 1;
  }
  .btn-update-container {
    transform: translate3d(0, -100%, 0);
    opacity: 0;
  }
}
</style>
