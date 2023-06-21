<template>
  <div class="d-flex flex-column align-items-center justify-content-center min-vh100 p-2">
    <logo
      class="logo-shutdown mb-5"
      :class="hasShutdown ? 'logo-gray' : ''"
     />
    <span class="text-white w-75 text-center">
      <small
        v-if="hasShutdown"
      >Shutdown complete. You can now safely unplug your Umbrel from the power and internet.</small>
      <small v-else-if="shuttingDown">
        <b-spinner small class="mr-2"></b-spinner>Shutting down...
      </small>
      <small v-else-if="rebooting">
        <b-spinner small class="mr-2"></b-spinner>Rebooting...
      </small>
    </span>
    <slot></slot>
  </div>
</template>

<script>
import Logo from '@/components/Logo.vue';

export default {
  data() {
    return {};
  },
  created() {},
  methods: {},
  components: {
    Logo,
  },
  props: {
    hasShutdown: Boolean,
    shuttingDown: Boolean,
    rebooting: Boolean
  }
};
</script>

<style lang="scss" scoped>
.logo-shutdown {
  transition: filter 0.3s ease;
  &.logo-gray {
    filter: grayscale(100%);
  }
}
</style>
