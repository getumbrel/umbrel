<template>
  <div
    class="otp-input-container"
    :class="{
      'error': error,
      'success': success
  }">
    <b-input v-model="digit1" ref="digitOneInput" class="neu-input otp-input" type="text" inputmode="numeric" placeholder="•" @keyup="keyup" :disabled="disabled" :autofocus="autofocus" />
    <b-input v-model="digit2" class="neu-input otp-input" type="text" inputmode="numeric" placeholder="•" @keyup="keyup" :disabled="disabled" />
    <b-input v-model="digit3" class="neu-input otp-input" type="text" inputmode="numeric" placeholder="•" @keyup="keyup" :disabled="disabled" />
    <b-input v-model="digit4" class="neu-input otp-input" type="text" inputmode="numeric" placeholder="•" @keyup="keyup" :disabled="disabled" />
    <b-input v-model="digit5" class="neu-input otp-input" type="text" inputmode="numeric" placeholder="•" @keyup="keyup" :disabled="disabled" />
    <b-input v-model="digit6" class="neu-input otp-input" type="text" inputmode="numeric" placeholder="•" @keyup="keyup" :disabled="disabled" />
  </div>
</template>

<script>
import delay from "@/helpers/delay";

export default {
  data() {
    return {
      digit1: "",
      digit2: "",
      digit3: "",
      digit4: "",
      digit5: "",
      digit6: "",
    };
  },
  props: {
    error: {
      type: Boolean,
      default: false
    },
    success: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    },
    autofocus: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    otpToken() {
      return `${this.digit1}${this.digit2}${this.digit3}${this.digit4}${this.digit5}${this.digit6}`;
    }
  },
  methods: {
    keyup(event) {
      this.$emit("keyup", event);

      // backspace / delete keypress logic
      if (event.code === "Backspace" || event.code === "Delete") {
        // ignore on first input or if there's still text in the input
        if (event.target.previousElementSibling && !event.target.value) {
          event.target.previousElementSibling.focus();
        }
        return;
      } 

      // reset input on everything except a single digit
      if (!event.target.value.match(/^[0-9]$/)) {
        return event.target.value = "";
      }

      // let browser hand logic for control keys
      if (event.key === "Tab" || event.key === "Control" || event.key === "Meta" || event.key === "Alt") {
        return;
      }

      // shift focus to next input if it exists and isn't empty
      if (event.target.nextElementSibling && !event.target.nextElementSibling.value) {
        return event.target.nextElementSibling.focus();
      }

      // emit otp
      return this.emitOtpToken();
    },
    emitOtpToken() {
      if (this.digit1 && this.digit2 && this.digit3 && this.digit4 && this.digit5 && this.digit6) {
        return this.$emit("otpToken", this.otpToken);
      }
    }
  },
  watch: {
    digit1(value) {
      // copy-paste logic
      if (value.length === 6 && !this.digit2 && !this.digit3 && !this.digit4 && !this.digit5 && !this.digit6) {
        this.digit1 = value[0];
        this.digit2 = value[1];
        this.digit3 = value[2];
        this.digit4 = value[3];
        this.digit5 = value[4];
        this.digit6 = value[5];
        return this.emitOtpToken();
      }
    },
    async error(errored) {
      // reset values on error
      if (errored) {
        // delay for ripple animation
        await delay(600);
        this.digit1 = "";
        this.digit2 = "";
        this.digit3 = "";
        this.digit4 = "";
        this.digit5 = "";
        this.digit6 = "";
        this.$refs.digitOneInput.focus();
      }
    }
  }    
};
</script>

<style lang="scss" scoped>
.otp-input-container {
  display: block;
  width: 100%;
  margin: auto;
  padding: 0;
  .otp-input {
    display: inline-block;
    width: 14.58%;
    height: 50px;
    text-align: center;
    transition: background-color 0.3s, color 0.3s;
    cursor: default;
    margin: 0;
    margin-top: 10px;
    margin-right: 2.5%;
    padding: 0;
    &:focus {
      outline: 0;
      -webkit-tap-highlight-color: transparent;
    }
    &:last-child {
      margin-right: 0;
    }
  }
  &.error {
    animation: shake 1s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    perspective: 1000px;
  }
  &.success {
    .otp-input {
      animation: two-factor-success 0.6s ease;
    }
  }
  &.error {
    .otp-input {
      animation: two-factor-error 0.6s ease;
    }
  }
  &.error, &.success {
    :nth-child(1) {
      animation-delay: 80ms;
    }
    :nth-child(2) {
      animation-delay: 160ms;
    }
    :nth-child(3) {
      animation-delay: 240ms;
    }
    :nth-child(4) {
      animation-delay: 320ms;
    }
    :nth-child(5) {
      animation-delay: 400ms;
    }
    :nth-child(6) {
      animation-delay: 480ms;
    }
  }
}

@keyframes shake {
  10%,
  90% {
    transform: translate3d(-1px, 0, 0);
  }

  20%,
  80% {
    transform: translate3d(2px, 0, 0);
  }

  30%,
  50%,
  70% {
    transform: translate3d(-4px, 0, 0);
  }

  40%,
  60% {
    transform: translate3d(4px, 0, 0);
  }
}

@keyframes two-factor-success {
  0%,
  100% {
    background: inherit;
    color: inherit;
  }
  50% {
    background: var(--success);
    color: rgba(255, 255, 255, 0.75);
  }
}

@keyframes two-factor-error {
  0%,
  100% {
    background: inherit;
    color: inherit;
  }
  50% {
    background: var(--danger);
    color: rgba(255, 255, 255, 0.75);
  }
}

</style>
