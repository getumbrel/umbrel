<template>
  <div @click="toggleUnit" class="toggle" :class="`toggle-${size}`">
    <div
      class="toggle-bg-text justify-content-center d-flex align-items-center"
    >
      <span class="text-center">Sats</span>
      <span class="text-center">BTC</span>
    </div>
    <div
      class="toggle-switch justify-content-center d-flex align-items-center"
      :class="{
        'toggle-left': unit === 'sats',
        'toggle-right': unit === 'btc'
      }"
    >
      <span class="text-muted" v-if="unit === 'sats'">Sats</span>
      <span class="text-muted" v-else-if="unit === 'btc'">BTC</span>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    size: {
      type: String, //sm, md, lg
      default: "md"
    }
  },
  data() {
    return {};
  },
  computed: {
    unit() {
      return this.$store.state.system.unit;
    }
  },
  methods: {
    toggleUnit() {
      if (this.unit === "sats") {
        this.$store.dispatch("system/changeUnit", "btc");
      } else if (this.unit === "btc") {
        this.$store.dispatch("system/changeUnit", "sats");
      }
    }
  }
};
</script>
