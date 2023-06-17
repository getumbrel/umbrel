<template>
  <div>
    <span>{{ title }}</span>
    <div class="pt-2 pb-3">
      <div class="mb-1">
        <!-- Loading state -->
        <span
          class="loading-placeholder loading-placeholder-lg w-50 mt-2"
          v-if="numberValue === -1"
          style
        ></span>
        <div class="d-flex align-items-baseline" v-else>
          <h3 class="font-weight-normal mb-0">
            <!-- suffix number like 100K, 120K, 2M, etc -->
            <CountUp
              :value="{
                endVal: numberValue,
                decimalPlaces: hasDecimals ? 5 : 0
              }"
              :suffix="numberSuffix"
              countOnLoad
            />
          </h3>
          <span class="text-muted" style="margin-left: 0.5rem;">{{
            suffix
          }}</span>
        </div>
      </div>
      <div
        v-if="(showNumericChange || showPercentChange) && change.value !== 0"
      >
        <svg
          width="12"
          height="13"
          viewBox="0 0 12 13"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          class="change-arrow"
          :class="{
            rising: change.value > 0,
            declining: change.value < 0,
            neutral: change.value === 0
          }"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M1.11092 1.90381C1.11092 2.45609 1.55863 2.90381 2.11092 2.90381H8.18198L0.696702 10.3891C0.306178 10.7796 0.306178 11.4128 0.696702 11.8033C1.08723 12.1938 1.72039 12.1938 2.11092 11.8033L9.69588 4.21833L9.95069 10.079C9.97468 10.6307 10.4414 11.0586 10.9932 11.0346C11.545 11.0106 11.9728 10.5439 11.9488 9.9921L11.5953 1.86037C11.572 1.32549 11.1316 0.903809 10.5962 0.903809H2.11092C1.55863 0.903809 1.11092 1.35152 1.11092 1.90381Z"
            fill="#00CD98"
          />
        </svg>
        <span
          class="change-text ml-1"
          :class="{
            'text-success': change.value > 0,
            'text-danger': change.value < 0,
            'text-muted': change.value === 0
          }"
        >
          {{ change.value >= 0 ? "+" : "" }}{{ change.value
          }}{{ change.suffix }}
        </span>
      </div>
      <div class="d-block" v-else>
        <span style="opacity: 0;">.</span>
      </div>
    </div>
  </div>
</template>

<script>
import CountUp from "@/components/Utility/CountUp";

const abbreviate = n => {
  if (n < 1e2) return [Number(n), ""];
  if (n >= 1e2 && n < 1e3) return [Number(n.toFixed(1)), ""];
  if (n >= 1e3 && n < 1e6) return [Number((n / 1e3).toFixed(1)), "K"];
  if (n >= 1e6 && n < 1e9) return [Number((n / 1e6).toFixed(1)), "M"];
  if (n >= 1e9 && n < 1e12) return [Number((n / 1e9).toFixed(1)), "B"];
  if (n >= 1e12) return [Number(+(n / 1e12).toFixed(1)), "T"];
};

export default {
  props: {
    title: String,
    value: Number,
    suffix: String,
    abbreviateValue: {
      type: Boolean,
      default: false
    },
    hasDecimals: {
      type: Boolean,
      default: false
    },
    showNumericChange: {
      type: Boolean,
      default: false
    },
    showPercentChange: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    numberValue() {
      if (!this.abbreviateValue) {
        return this.value;
      } else {
        return abbreviate(this.value)[0];
      }
    },
    numberSuffix() {
      if (!this.abbreviateValue) {
        return "";
      } else {
        return abbreviate(this.value)[1];
      }
    }
  },
  data() {
    return {
      change: {
        value: 0,
        suffix: ""
      }
    };
  },
  methods: {},
  watch: {
    value(newValue, oldValue) {
      if (this.showNumericChange) {
        if (oldValue <= 0) {
          this.change = {
            value: 0,
            suffix: ""
          };
        } else {
          if (!this.abbreviateValue) {
            this.change = {
              value: newValue - oldValue,
              suffix: ""
            };
          } else {
            //because fn abbreviate doesn't work with negative numbers
            if (newValue - oldValue < 0) {
              this.change = {
                value: abbreviate(oldValue - newValue)[0] * -1,
                suffix: abbreviate(oldValue - newValue)[1]
              };
            } else {
              this.change = {
                value: abbreviate(newValue - oldValue)[0],
                suffix: abbreviate(newValue - oldValue)[1]
              };
            }
          }
        }
      } else if (this.showPercentChange) {
        if (oldValue <= 0) {
          this.change = {
            value: 0,
            suffix: "%"
          };
        } else {
          this.change = {
            value: Math.round(((newValue - oldValue) * 100) / oldValue),
            suffix: "%"
          };
        }
      }
    }
  },
  components: {
    CountUp
  }
};
</script>

<style lang="scss" scoped>
.change-arrow {
  transition: transform 0.4s ease-in-out;
  path {
    transition: fill 0.4s ease-in-out;
  }
  &.neutral {
    transform: rotate(-45deg);
    path {
      fill: var(--gray);
    }
  }
  &.rising {
    path {
      fill: var(--success, #00cd98);
    }
  }
  &.declining {
    transform: rotate(90deg);
    path {
      fill: var(--danger, #f46e6e);
    }
  }
}

.change-text {
  transition: color 0.4s ease;
}
</style>
