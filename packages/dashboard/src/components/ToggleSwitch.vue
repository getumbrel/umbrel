<template>
  <div
    @click="toggle"
    class="toggle"
    :class="{ 'toggle-off': !on, 'toggle-on': on, 'toggle-disabled': disabled, 'toggle-loading': loading }"
    v-b-tooltip.hover.left
    :title="tooltip"
  >
    <div
      class="toggle-switch justify-content-center"
      :class="{
        'toggle-switch-off': !on,
        'toggle-switch-on': on
      }"
    ></div>
  </div>
</template>

<script>
export default {
  computed: {},
  methods: {
    toggle() {
      if (this.disabled) {
        return;
      }
      const emitEvent = !this.on ? "turnOn" : "turnOff";
      return this.$emit(emitEvent, !this.on);
    }
  },
  props: {
    disabled: {
      type: Boolean,
      default: false
    },
    loading: {
      type: Boolean,
      default: false
    },
    tooltip: {
      type: String,
      default: ""
    },
    on: {
      type: Boolean,
      default: true
    }
  }
};
</script>

<style scoped lang="scss">
.toggle {
  border-radius: 30px;
  width: 60px;
  height: 36px;
  box-sizing: border-box;
  display: flex;
  cursor: pointer;
  background: var(--toggle-switch-off-background-color);
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: inset 0px 5px 10px rgba(0, 0, 0, 0.1);
  &.toggle-on {
    background: var(--success);
    box-shadow: none;
  }
  &.toggle-disabled {
    cursor: not-allowed;
  }
  &.toggle-loading {
    cursor: wait;
  }
}
.toggle-switch {
  margin: 2px;
  height: 30px;
  width: 30px;
  border-radius: 30px;
  background: #ffffff;
  transition: transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.toggle-switch-off {
  transform: translateX(0);
  box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
}
.toggle-switch-on {
  transform: translateX(24px);
  box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
}
</style>
