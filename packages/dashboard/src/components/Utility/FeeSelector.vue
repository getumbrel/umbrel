<template>
  <div>
    <div class="d-flex w-100 justify-content-between">
      <small class="text-muted d-block mb-0">Transaction Fee</small>
      <b-form-checkbox
        v-model="useCustomFee"
        class=""
        size="sm"
        switch
        :disabled="isDisabled"
      >
        <small class="text-muted">Custom</small>
      </b-form-checkbox>
    </div>
    <div class="vue-slider-container" v-if="useCustomFee">
      <vue-slider
        v-model="customFee"
        :marks="false"
        hide-label
        :min="customMinFee"
        :max="customMaxFee"
        :interval="1"
        :dotSize="[22, 22]"
        contained
        :tooltip="isDisabled ? 'none' : 'always'"
        :disabled="isDisabled"
        @change="emitValue"
        key="custom-fee"
      >
        <template v-slot:tooltip="{ value, focus }">
          <div
            :class="[
              'vue-slider-dot-tooltip-inner vue-slider-dot-tooltip-inner-top',
              { focus }
            ]"
          >
            <span class="vue-slider-dot-tooltip-text d-block"
              >{{ value }} sat/vB
            </span>
            <small class="text-muted"
              >≈
              {{
                ((parseInt(fee.fast.total, 10) /
                  parseInt(fee.fast.perByte, 10)) *
                  value)
                  | satsToUSD
              }}</small
            >
          </div>
        </template>
      </vue-slider>
      <div class="d-flex w-100 justify-content-between custom-fee-labels">
        <small class="text-muted mb-0">Slow</small>
        <small class="text-muted mb-0">Fast</small>
      </div>
    </div>
    <div class="vue-slider-container" v-else>
      <vue-slider
        v-model="chosenFee"
        absorb
        marks
        :data="recommendedFees"
        :dotSize="[22, 22]"
        contained
        :tooltip="isDisabled ? 'none' : 'always'"
        :disabled="isDisabled"
        @change="emitValue"
        key="recommended-fee"
      >
        <template v-slot:label="{ active, value }">
          <div :class="['vue-slider-mark-label', 'text-center', { active }]">
            <span class="text-muted">~ {{ timeToConfirm(value) }}</span>
          </div>
        </template>
        <template v-slot:tooltip="{ value, focus }">
          <div
            :class="[
              'vue-slider-dot-tooltip-inner vue-slider-dot-tooltip-inner-top',
              { focus }
            ]"
          >
            <span class="vue-slider-dot-tooltip-text d-block mb-0"
              >{{ fee[value].perByte }} sat/vB
            </span>
            <small class="text-muted"
              >≈ {{ fee[value].total | satsToUSD }}</small
            >
          </div>
        </template>
      </vue-slider>
    </div>
  </div>
</template>

<script>
import VueSlider from "vue-slider-component";
import "vue-slider-component/theme/default.css";

export default {
  props: {
    fee: Object,
    customMinFee: {
      type: Number,
      default: 1
    },
    customMaxFee: {
      type: Number,
      default: 350
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      chosenFee: "normal",
      useCustomFee: false,
      customFee: 30
    };
  },
  computed: {
    isDisabled() {
      return (
        this.fee.fast.total <= 0 ||
        this.fee.fast.total === "--" ||
        this.fee.fast.total === "N/A" ||
        this.disabled
      );
    },
    recommendedFees() {
      if (this.isDisabled) {
        return ["cheapest", "slow", "normal", "fast"];
      }
      const intervals = [];
      if (this.fee.cheapest && !this.fee.cheapest.error) {
        intervals.push("cheapest");
      }
      if (this.fee.slow && !this.fee.slow.error) {
        intervals.push("slow");
      }
      if (this.fee.normal && !this.fee.normal.error) {
        intervals.push("normal");
      }
      if (this.fee.fast && !this.fee.fast.error) {
        intervals.push("fast");
      }
      return intervals;
    }
  },
  methods: {
    emitValue() {
      if (this.useCustomFee) {
        const fee = {
          type: "custom",
          satPerByte: parseInt(this.customFee, 10)
        };
        this.$emit("change", fee);
      } else {
        const fee = {
          type: this.chosenFee,
          satPerByte: parseInt(this.fee[this.chosenFee].perByte, 10)
        };
        this.$emit("change", fee);
      }
    },
    timeToConfirm(fee) {
      if (fee === "fast") {
        return "10 min";
      }
      if (fee === "normal") {
        return "60 min";
      }
      if (fee === "slow") {
        return "4 hrs";
      }
      if (fee === "cheapest") {
        return "24 hrs";
      }
    }
  },
  watch: {
    useCustomFee: function() {
      this.emitValue();
    },
    "fee.fast.total": function() {
      this.emitValue();
    }
  },
  components: {
    VueSlider
  }
};
</script>

<style lang="scss">
/* Set the theme color of the component */
$themeColor: #edeef1;

$bgColor: #edeef1;
$railBorderRadius: 15px !default;

$dotShadow: 0px 4px 10px rgba(0, 0, 0, 0.25);
$dotShadowFocus: 0px 4px 10px rgba(0, 0, 0, 0.4);
$dotBgColor: #fff !default;
$dotBgColorDisable: #ccc !default;
$dotBorderRadius: 50% !default;

$tooltipBgColor: #fff !default;
$tooltipColor: #141821 !default;
$tooltipBorderRadius: 5px !default;
$tooltipPadding: 2px 5px !default;
$tooltipMinWidth: 20px !default;
$tooltipArrow: 10px !default;
$tooltipFontSize: 0.8rem !default;

$stepBorderRadius: 50% !default;
$stepBgColor: rgba(0, 0, 0, 0.1) !default;

$labelFontSize: 0.8rem;

/* import theme style */
@import "~vue-slider-component/lib/theme/default.scss";

.vue-slider-container {
  padding-top: 3rem;
  padding-bottom: 1.5rem;
  margin-bottom: 1rem;
  position: relative;
}

.vue-slider-ltr .vue-slider-mark-label,
.vue-slider-rtl .vue-slider-mark-label {
  margin-top: 1rem;
}

.vue-slider-dot {
  //   transition: left 0.5s cubic-bezier(0.77, 0, 0.175, 1) !important;
}

.vue-slider-dot-handle {
  transition: box-shadow 0.2s, background-color 0.2s ease;
}
.vue-slider-dot-tooltip {
  transition: opacity 0.2s ease;
}

.vue-slider-rail {
  cursor: pointer;
  background: linear-gradient(to right, #f6b900, #00cd98);
}
.vue-slider-process {
  background-color: transparent;
}
.vue-slider-disabled {
  .vue-slider-rail {
    cursor: not-allowed;
    background: #ccc;
  }
}
.vue-slider-dot-handle-disabled {
  box-shadow: none;
}
.vue-slider-mark-label {
  //   text-transform: capitalize;
}
.vue-slider-ltr {
  .vue-slider-mark:first-child {
    .vue-slider-mark-label,
    .vue-slider-mark-label {
      left: 0;
      transform: translateX(0);
      text-align: left !important;
    }
  }
  .vue-slider-mark:last-child {
    .vue-slider-mark-label,
    .vue-slider-mark-label {
      left: 100%;
      transform: translateX(-100%);
      text-align: right !important;
    }
  }
}

.vue-slider-dot-tooltip-inner {
  padding: 5px;
  font-size: 0.75rem;
  line-height: 1rem;
  box-shadow: 0 3px 15px rgba(0, 0, 0, 0.18);
}

.custom-fee-labels {
  position: absolute;
  bottom: 0;
  left: 0;
}
</style>
