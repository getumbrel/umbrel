<template>
  <div v-if="complete" class="d-flex flex-column align-items-center justify-content-center min-vh100 p-2">
    <logo compact class="mb-1 logo-loading" />
    <h2 class="text-white text-center">Migration successful!</h2>

    <div class="text-center">
      <small class="text-white d-block">All your apps, app data, and account details have been migrated to your Umbrel Home.</small>
      <b-button
      variant="default"
      type="submit"
      class="mt-4 px-4 login-button bg-white font-weight-bold"
      pill
      @click="redirectToLogin"
      >Continue to log in</b-button
      >
    </div>
  </div>
  <div v-else class="d-flex flex-column align-items-center justify-content-center min-vh100 p-2">
    <div class="d-flex flex-column align-items-center justify-content-center">
      <logo compact class="mb-1 logo-loading" />
      <h2 class="text-white text-center mb-4">Migration Assistant</h2>
      
      <b-progress
      :value="status.progress"
      class="mb-2 w-25 loading-progress"
      variant="light"
      :style="{ height: '4px' }"
      ></b-progress>
      
      <div class="text-center">
        <small class="text-white d-block">{{`${status.description}...`}}</small>
        <b-alert class="alert-system" variant="glass" show>
          <div class="d-flex align-items-center">
            <small>⚠️ Do not turn off your Umbrel Home until the migration is complete</small>
          </div>
        </b-alert>
      </div>
    </div>
  </div>
</template>

<script>
import Logo from '@/components/Logo.vue';

export default {
  data() {
    return {};
  },
  props: { status: Object, complete: Boolean },
  created() {},
  methods: {
    redirectToLogin() {
      // reload page to reset state
      // alternatively, we could just reset all migrationState here
      window.location.reload();
    }
  },
  components: {
    Logo,
  }
};
</script>

<style lang="scss" scoped>
.logo-loading {
  height: 6.5vh;
  max-height: 200px;
  width: auto;
}
.progress {
  background-color: rgba(255, 255, 255, 0.4) !important; 
}
.loading-progress {
  min-width: 260px;
}

.alert-system {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translate3d(-50%, 0, 0);
}
</style>
