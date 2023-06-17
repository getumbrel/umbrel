<template>
  <div
    class="qr-container"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @click="$emit('click')"
  >
    <!-- Popup umbrel logo in the middle of QR code -->
    <transition name="qr-logo-popup" appear>
      <img v-show="showLogo" src="@/assets/umbrel-qr-icon.svg" class="qr-logo" />
    </transition>

    <!-- QR Code element -->
    <qrcode-vue
      :value="value"
      :size="size"
      :level="level"
      renderAs="svg"
      class="d-flex justify-content-center qr-image"
    ></qrcode-vue>
  </div>
</template>

<script>
import QrcodeVue from "qrcode.vue";

export default {
  props: {
    size: {
      type: Number,
      default: 200
    },
    level: {
      type: String,
      default: "H"
    },
    value: String,
    showLogo: {
      type: Boolean,
      default: true
    }
  },
  data() {
    return {};
  },
  computed: {},
  methods: {},
  components: {
    QrcodeVue
  }
};
</script>

<style lang="scss" scoped>
// Transition for umbrel logo popping up on QR
.qr-logo-popup-enter-active,
.qr-logo-popup-leave-active {
  &.qr-logo {
    transition: transform 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
}

.qr-logo-popup-enter {
  &.qr-logo {
    transform: translate3d(-50%, -50%, 0) scale(0);
    opacity: 0;
  }
}

.qr-logo-popup-enter-to,
.qr-logo-popup-leave,
.qr-logo-popup-leave-to {
  &.qr-logo {
    transform: translate3d(-50%, -50%, 0) scale(1);
    opacity: 1;
  }
}

.qr-container {
  position: relative;
}
.qr-logo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 25%;
  height: 25%;
  transform: translate3d(-50%, -50%, 0) scale(1);
}
</style>
