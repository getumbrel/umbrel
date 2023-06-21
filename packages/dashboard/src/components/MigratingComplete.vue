<template>
  <div class="d-flex flex-column align-items-center justify-content-center min-vh100 p-2">
    <logo compact class="mb-1 logo-loading" />
    <h2 v-if="error" class="text-white text-center">Migration failed</h2>
    <h2 v-else class="text-white text-center">Migration successful!</h2>

    <div class="text-center">
      <div v-if="error">
        <small class="text-white d-block">There was an error during migration.</small>
        <small class="text-white d-block">Please try again.</small>
      </div>
      <div v-else>
        <small class="text-white d-block">All your data, including your apps, has been migrated to your Umbrel Home.</small>
        <small class="text-white d-block">You can now safely disconnect your Raspberry Pi's drive and log in using your previous password.</small>
      </div>
      <b-button
      variant="default"
      type="submit"
      class="mt-4 px-4 login-button bg-white font-weight-bold"
      pill
      @click="resetMigrationState"
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
  props: { error: Boolean },
  computed: {},
  created() {},
  mounted() {},
  beforeDestroy() {},
  methods: {
    resetMigrationState() {
      this.$store.dispatch("system/resetMigrationState");

      // alternatively, could reload page
      // window.location.reload();
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

.alert-system {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translate3d(-50%, 0, 0);
}
</style>
