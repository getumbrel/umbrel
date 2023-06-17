<template>
  <div class="channel-bar" :style="style"></div>
</template>

<script>
export default {
  computed: {
    style() {
      const leftValue = this.local;
      const rightValue = this.remote;
      const leftPercent = Math.round(
        (leftValue * 100) / (leftValue + rightValue)
      );

      let background;
      if (leftPercent === 100) {
        background = `#5351FB`;
      } else if (leftPercent === 0) {
        background = `#00CD98`;
      } else {
        background = `linear-gradient(90deg, #5351FB 0%, #5351FB ${leftPercent -
          7}%, #00CD98 ${leftPercent + 7}%, #00CD98 100%)`;
      }

      let height = "4px";
      let borderRadius = "4px";

      if (this.size === "lg") {
        height = "8px";
        borderRadius = "8px";
      }

      return {
        background,
        height,
        borderRadius
      };
    }
  },
  data() {
    return {};
  },
  methods: {
    getChannelBarGradient(leftValue, rightValue) {
      const leftPercent = Math.round(
        (leftValue * 100) / (leftValue + rightValue)
      );
      if (leftPercent === 100) {
        return `#5351FB`;
      }
      if (leftPercent === 0) {
        return `#00CD98`;
      }
      return `linear-gradient(90deg, #5351FB 0%, #5351FB ${leftPercent -
        7}%, #00CD98 ${leftPercent + 7}%, #00CD98 100%)`;
    }
  },
  props: {
    local: Number,
    remote: Number,
    size: {
      type: String, //sm, lg
      default: "sm"
    }
  },
  components: {}
};
</script>

<style lang="scss" scoped>
.channel-bar {
  height: 4px;
  border-radius: 4px;
}
</style>
