<template>
  <div class="d-flex flex-column align-items-center justify-content-center min-vh100 p-2">
    <logo compact class="mb-1 logo-loading" />
    <h2 class="text-white text-center">Migration failed</h2>

    <div class="text-center">
      <small class="text-white d-block">There was an error during migration.</small>
      <small class="text-white d-block">Please log in to try again.</small>
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
</template>

<script>
import Logo from '@/components/Logo.vue';

export default {
  data() {
    return {};
  },
  props: {},
  created() {},
  methods: {
    redirectToLogin() {
      // reload page to reset state
      // alternatively, we could just reset all migrationState here
      window.location.reload();
    },
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
