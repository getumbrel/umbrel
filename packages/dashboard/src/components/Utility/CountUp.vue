<template>
  <span class="d-flex">
    <span ref="number"></span>
    {{ suffix }}
    <!-- <small>{{ endVal }}</small> -->
  </span>
</template>

<script>
import { CountUp } from "countup.js";
const typeOf = type => object =>
  Object.prototype.toString.call(object) === `[object ${type}]`;
const isFunction = typeOf("Function");
export default {
  props: {
    delay: {
      type: Number,
      required: false,
      default: 0
    },
    value: {
      type: Object,
      required: true
    },
    options: {
      type: Object,
      required: false
    },
    suffix: {
      type: String,
      required: false,
      default: ""
    },
    countOnLoad: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      startVal: 0,
      instance: null,
      firstLoad: true //used to decide if animate/count on the first mount
    };
  },
  computed: {},
  mounted() {
    const that = this;
    that.create();
  },
  beforeDestroy() {
    const that = this;
    that.destroy();
  },
  methods: {
    create() {
      const that = this;
      if (that.instance) {
        return;
      }
      const dom = that.$refs.number;
      const options = that.options || {};

      if (this.firstLoad) {
        if (this.countOnLoad) {
          this.startVal = 0;
        } else {
          this.startVal = this.value.endVal;
        }
      }
      options.decimalPlaces = this.value.decimalPlaces || 0;

      options.startVal = this.startVal;

      const instance = new CountUp(dom, that.value.endVal, options);
      if (instance.error) {
        // error
        return;
      }
      that.instance = instance;
      if (that.delay < 0) {
        that.$emit("ready", instance, CountUp);
        return;
      }
      setTimeout(() => {
        instance.start(() => that.$emit("ready", instance, CountUp));
        this.firstLoad = false;
      }, that.delay);
    },
    destroy() {
      const that = this;
      that.instance = null;
    },
    printValue(value) {
      const that = this;
      if (that.instance && isFunction(that.instance.printValue)) {
        return that.instance.printValue(value);
      }
    },
    start(callback) {
      const that = this;
      if (that.instance && isFunction(that.instance.start)) {
        return that.instance.start(callback);
      }
    },
    pauseResume() {
      const that = this;
      if (that.instance && isFunction(that.instance.pauseResume)) {
        return that.instance.pauseResume();
      }
    },
    reset() {
      const that = this;
      if (that.instance && isFunction(that.instance.reset)) {
        return that.instance.reset();
      }
    },
    update(newEndVal) {
      const that = this;
      if (that.instance && isFunction(that.instance.update)) {
        return that.instance.update(newEndVal);
      }
    }
  },
  watch: {
    value: {
      handler(newVal, oldVal) {
        if (newVal.decimalPlaces !== oldVal.decimalPlaces) {
          this.destroy();
          this.startVal = 0;
          this.create();
        } else {
          if (newVal.endVal !== oldVal.endVal) {
            this.update(newVal.endVal);
          }
        }
      },
      deep: true
    }
  },
  components: {}
};
</script>

<style lang="scss" scoped>
span {
  word-break: break-all;
}
</style>
