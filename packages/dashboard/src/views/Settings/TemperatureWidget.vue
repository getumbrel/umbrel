<template>
  <card-widget
    header="CPU Temperature"
    :status="cardStatus"
  >

  <div class="card-custom-body">
    <div class="card-app-info px-3 px-xl-4">
      <div class="d-flex w-100 justify-content-between mb-4">
        <div>
          <div>
            <h3 class="mb-1">
              <CountUp
                :value="{
                  endVal: cpuTemperatureInUnit,
                  decimalPlaces: 0,
                }"
              />
            </h3>
            <div @click="toggleUnit" class="toggle toggle-sm mt-2">
              <div
                class="toggle-bg-text justify-content-center d-flex align-items-center"
              >
                <span class="text-center">&#176;C</span>
                <span class="text-center">&#176;F</span>
              </div>
              <div
                class="toggle-switch justify-content-center d-flex align-items-center"
                :class="{
                  'toggle-left': cpuTemperatureUnit === 'celsius',
                  'toggle-right': cpuTemperatureUnit === 'fahrenheit'
                }"
              >
                <span class="toggle-switch-text" v-if="cpuTemperatureUnit === 'celsius'">&#176;C</span>
                <span class="toggle-switch-text" v-else-if="cpuTemperatureUnit === 'fahrenheit'">&#176;F</span>
              </div>
            </div>
          </div>
        </div>
        <svg :class="cpuTemperature > 85 ? 'shake' : ''" width="66" height="66" viewBox="0 0 66 66" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect class="fill-ease" width="66" height="66" rx="12" :fill="thermometerBgColor"/>
          <path d="M33.2286 14C29.9322 14 27.23 16.6492 27.23 19.881V36.1614C25.2798 37.8187 24 40.228 24 42.9524C24 47.9329 28.1484 52 33.2286 52C38.3087 52 42.4571 47.9329 42.4571 42.9524C42.4571 40.228 41.1774 37.8187 39.2271 36.1614V19.881C39.2271 16.6492 36.525 14 33.2286 14ZM33.2286 16.7143C35.0282 16.7143 36.4586 18.1166 36.4586 19.881V36.7427C36.4586 36.9563 36.5101 37.1668 36.6087 37.3572C36.7074 37.5475 36.8505 37.7124 37.0263 37.8384C38.6399 38.9931 39.6886 40.8412 39.6886 42.9524C39.6886 46.4657 36.8122 49.2857 33.2286 49.2857C29.645 49.2857 26.7686 46.4657 26.7686 42.9524C26.7686 40.8412 27.8172 38.9931 29.4308 37.8384C29.6067 37.7124 29.7498 37.5475 29.8484 37.3572C29.9471 37.1668 29.9985 36.9563 29.9986 36.7427V19.881C29.9986 18.1166 31.4289 16.7143 33.2286 16.7143Z" fill="white"/>
          <circle cx="33.25" cy="43.25" r="4.5" fill="white"/>
          <line x1="33.3252" y1="42.625" x2="33.3252" :y2="thermometerHeight" stroke="white" stroke-width="2.75" stroke-linecap="round"/>
        </svg>
      </div>

      <b-alert v-if="cpuTemperature > 80" :variant="cpuTemperature > 85 ? 'danger' : 'warning'" class="mb-4" show><small>Your Raspberry Pi is {{ cpuTemperature > 85 ? 'dangerously' : 'running' }} hot. Consider using a heatsink, fan or a cooling case.</small></b-alert>
    </div>
  </div>
  </card-widget>
</template>

<script>
import { mapState } from "vuex";

import CountUp from "@/components/Utility/CountUp";
import CardWidget from "@/components/CardWidget";

export default {
  data() {
    return {
      // cpuTemperature: 21
    };
  },
  props: {
  },
  computed: {
    ...mapState({
      cpuTemperature: state => state.system.cpuTemperature, // in celsius
      cpuTemperatureUnit: state => state.system.cpuTemperatureUnit
    }),
    cpuTemperatureInUnit() {
      if (this.cpuTemperatureUnit === "fahrenheit") {
        return Math.round((this.cpuTemperature * 1.8) + 32);
      }
      return this.cpuTemperature;
    },
    cardStatus() {
      if (this.cpuTemperature === 69) {
        return {
          text: "Nice",
          variant: "success",
          blink: false
        };        
      }
      if (this.cpuTemperature > 85) {
        return {
          text: "Too hot",
          variant: "danger",
          blink: true
        };
      }
      if (this.cpuTemperature > 80) {
        return {
          text: "Hot",
          variant: "warning",
          blink: true
        };
      }
      return {
        text: "Normal",
        variant: "success",
        blink: false
      };
    },
    thermometerHeight() {
      if (this.cpuTemperature < 25) {
        return 40.375;
      }
      if (this.cpuTemperature > 80) {
        return 20.375;
      }
      return 40.375 - ((this.cpuTemperature - 25) / 2.75);
    },
    thermometerBgColor() {
      const temp = this.cpuTemperature;
      if (temp > 85) {
        return "#F45252";
      }
      if (temp > 80) {
        return "#F1736B";
      }
      if (temp > 75) {
        return "#F1836B";
      }
      if (temp > 70) {
        return "#F1936B";
      }
      if (temp > 65) {
        return "#F1A36B";
      }
      if (temp > 60) {
        return "#F1BB6B";
      }
      if (temp > 55) {
        return "#F1CB6B";
      }
      if (temp > 50) {
        return "#F4E44E";
      }
      if (temp > 45) {
        return "#E6E953";
      }
      if (temp > 40) {
        return "#C0EA67";
      }
      if (temp > 35) {
        return "#96F16B";
      }
      if (temp > 30) {
        return "#6BF188";
      }
      if (temp > 25) {
        return "#6BF1C9";
      }
      return "#6BF1E9";
    }
  },
  created() {
    // setTimeout(() => {
    //   setInterval(() => { 
    //   if (this.cpuTemperature !== 100) {
    //     // this.cpuTemperature = Number((this.cpuTemperature + 0.1).toFixed(1));
    //     this.cpuTemperature++;
    //   }
    //  }, 250);
    // }, 2000);
    this.$store.dispatch("system/getCpuTemperatureUnit");
  },
  methods: {
    toggleUnit() {
      if (this.cpuTemperatureUnit === "celsius") {
        this.$store.dispatch("system/changeCpuTemperatureUnit", "fahrenheit");
      } else if (this.cpuTemperatureUnit === "fahrenheit") {
        this.$store.dispatch("system/changeCpuTemperatureUnit", "celsius");
      }
    }
  },
  components: {
    CardWidget,
    CountUp
  }
};
</script>

<style lang="scss" scoped>
.shake {
  animation: shake 0.82s cubic-bezier(.36,.07,.19,.97) infinite;
  transform: translate3d(0, 0, 0) rotate(0);
  backface-visibility: hidden;
  perspective: 1000px;
}

.fill-ease {
  transition: fill 0.5s ease;
}

.toggle-switch-text {
  color: #8e8e8e;
}

@keyframes shake {
  10%, 90% {
    transform: translate3d(-4px, 0, 0) rotate(-10deg);
  }
  
  20%, 80% {
    transform: translate3d(4px, 2px, 0) rotate(10deg);
  }

  30%, 50%, 70% {
    transform: translate3d(-4px, 1px, 0) rotate(-5deg);
  }

  40%, 60% {
    transform: translate3d(4px, 4px, 0) rotate(5deg);
  }
}
</style>
