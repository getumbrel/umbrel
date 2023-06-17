<template>
<b-alert variant="warning" v-if="percent < 99 && (requires === 'electrum' || requires === 'bitcoind')" show>
    <svg
      class="icon-clock icon-clock-warning mr-1"
      viewBox="0 0 40 40"
    >
      <circle cx="20" cy="20" r="18" />
      <line x1="0" y1="0" x2="8" y2="0" class="hour" />
      <line x1="0" y1="0" x2="12" y2="0" class="minute" />
    </svg> You will be able to connect {{ name }} to your Umbrel {{ requires === "electrum" ? "~24 hours" : "" }} after Bitcoin Core has synchronized 100%.
  </b-alert>
  <card-widget v-else :header="`Here's how to connect ${name} to your Umbrel`">
    <div class="px-3 px-lg-4 pb-3">
      <slot></slot>
      <b-alert variant="info" v-if="requires === 'electrum'" show>
        Unable to connect to  {{ name }}? If Bitcoin Core has only recently finished syncing, please try connecting again in ~24 hours.
      </b-alert>
    </div>
  </card-widget>
</template>

<script>
import { mapState } from "vuex";
import CardWidget from "@/components/CardWidget";

export default {
  data() {
    return {};
  },
  props: {
    name: String,
    requires: {
      type: String,
      default: "" //electrum, bitcoin-core, lnd, or empty if no specific protocol required
    }
  },
  computed: {
    ...mapState({
      percent: state => state.bitcoin.percent
    })
  },
  methods: {},
  components: {
    CardWidget
  }
};
</script>

<style lang="scss" scoped></style>
