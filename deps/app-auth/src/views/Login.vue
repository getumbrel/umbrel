<template>
  <div class="w-100 position-relative">
    <div class="d-flex flex-column align-items-center justify-content-center min-vh100">
        <div class="card-glass px-3 px-sm-4 pb-4 mt-5 mt-sm-0 mx-2">
          <div class="top-icons-container">
            <logo class="icon logo logo-small" />
            <div class="divider"></div>
            <div id="app-icon-container">
              <span v-if="app"><img class="icon" :src="`https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/icon.svg`"></span>
              <svg
                class="installed-app-icon-frame" width="90" height="90" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"
              >
                <mask id="mask0_311_6906" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                <rect width="100" height="100" fill="white"/>
                </mask>
                <g mask="url(#mask0_311_6906)">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M100.354 0.353591L93.2071 7.50004H100V8.50004H92.5V32.5H100V33.5H92.5V66.5H100V67.5H92.5V91.5H100V92.5H93.2071L100.354 99.6465L99.6465 100.354L92.5 93.2071V100H91.5V92.5H67.5V100H66.5V92.5H33.5V100H32.5V92.5H8.50004V100H7.50004V93.2071L0.353591 100.354L-0.353516 99.6465L6.79293 92.5H3.77595e-05V91.5H7.50004V67.5H3.77595e-05V66.5H7.50004V33.5H3.77595e-05V32.5H7.50004V8.50004H3.77595e-05V7.50004H6.79293L-0.353516 0.353591L0.353591 -0.353516L7.50004 6.79293V3.77595e-05H8.50004V7.50004H32.5V3.77595e-05H33.5V7.50004H66.5V3.77595e-05H67.5V7.50004H91.5V3.77595e-05H92.5V6.79293L99.6465 -0.353516L100.354 0.353591ZM8.50004 9.20714V32.5H11.8083C13.8334 28.0878 16.6006 24.0869 19.9501 20.6572L8.50004 9.20714ZM20.6572 19.9501L9.20714 8.50004H32.5V11.8083C28.0878 13.8334 24.0869 16.6006 20.6572 19.9501ZM20.6572 21.3644C17.497 24.6022 14.8681 28.3611 12.9117 32.5H31.7929L20.6572 21.3644ZM32.5 31.7929L21.3644 20.6572C24.6022 17.497 28.3611 14.8681 32.5 12.9117V31.7929ZM33.5 34.2071V45.8908C34.2141 43.014 35.6609 40.4265 37.6308 38.3379L33.5 34.2071ZM38.3379 37.6308L34.2071 33.5H45.8908C43.014 34.2141 40.4265 35.6609 38.3379 37.6308ZM38.3383 39.0454C35.6481 41.9081 34 45.7616 34 50C34 54.2385 35.6481 58.092 38.3383 60.9547L49.2929 50L38.3383 39.0454ZM50 49.2929L39.0454 38.3383C41.9081 35.6481 45.7616 34 50 34C54.2385 34 58.092 35.6481 60.9547 38.3383L50 49.2929ZM50 50.7071L39.0454 61.6618C41.9081 64.352 45.7616 66 50 66C54.2385 66 58.092 64.352 60.9547 61.6618L50 50.7071ZM61.6618 60.9547L50.7071 50L61.6618 39.0454C64.352 41.9081 66 45.7616 66 50C66 54.2385 64.352 58.092 61.6618 60.9547ZM61.6621 62.3692C59.5735 64.3392 56.9861 65.7859 54.1093 66.5H65.7929L61.6621 62.3692ZM66.5 65.7929L62.3692 61.6621C64.3392 59.5735 65.7859 56.9861 66.5 54.1093V65.7929ZM67.5 68.2071V87.0883C71.639 85.1319 75.3979 82.5031 78.6357 79.3428L67.5 68.2071ZM79.3428 78.6357L68.2071 67.5H87.0883C85.1319 71.639 82.5031 75.3979 79.3428 78.6357ZM79.3429 80.05C75.9132 83.3995 71.9123 86.1667 67.5 88.1917V91.5H90.7929L79.3429 80.05ZM91.5 90.7929L80.05 79.3429C83.3995 75.9132 86.1667 71.9123 88.1917 67.5H91.5V90.7929ZM67.5 8.50004H90.7929L79.3429 19.9501C75.9132 16.6006 71.9123 13.8334 67.5 11.8083V8.50004ZM91.5 9.20714L80.05 20.6572C83.3995 24.0869 86.1667 28.0878 88.1917 32.5H91.5V9.20714ZM67.5 12.9117C71.639 14.8681 75.3979 17.497 78.6357 20.6572L67.5 31.7929V12.9117ZM79.3428 21.3644L68.2071 32.5H87.0883C85.1319 28.3611 82.5031 24.6022 79.3428 21.3644ZM54.1093 33.5H65.7929L61.6621 37.6308C59.5735 35.6609 56.9861 34.2141 54.1093 33.5ZM66.5 34.2071L62.3692 38.3379C64.3392 40.4265 65.7859 43.014 66.5 45.8908V34.2071ZM33.5 54.1093C34.2141 56.9861 35.6609 59.5735 37.6308 61.6621L33.5 65.7929V54.1093ZM38.3379 62.3692L34.2071 66.5H45.8908C43.014 65.7859 40.4265 64.3392 38.3379 62.3692ZM12.9117 67.5H31.7929L20.6572 78.6357C17.497 75.3979 14.8681 71.639 12.9117 67.5ZM32.5 68.2071L21.3644 79.3428C24.6022 82.5031 28.3611 85.1319 32.5 87.0883V68.2071ZM11.8083 67.5C13.8334 71.9123 16.6006 75.9132 19.9501 79.3429L8.50004 90.7929V67.5H11.8083ZM20.6572 80.05L9.20714 91.5H32.5V88.1917C28.0878 86.1667 24.0869 83.3995 20.6572 80.05ZM88.6349 33.5H91.5V43.4996C90.9571 40.0053 89.9834 36.6534 88.6349 33.5ZM66.5 11.3651V8.50004H56.5005C59.9948 9.04296 63.3467 10.0167 66.5 11.3651ZM43.4996 8.50004H33.5V11.3651C36.6534 10.0167 40.0053 9.04296 43.4996 8.50004ZM33.5 12.4554C38.5486 10.2335 44.1302 9.00004 50 9.00004C55.8698 9.00004 61.4515 10.2335 66.5 12.4554V31.218C62.0975 27.3473 56.3229 25 50 25C43.6772 25 37.9026 27.3473 33.5 31.218V12.4554ZM11.3651 33.5H8.50004V43.4996C9.04296 40.0053 10.0167 36.6534 11.3651 33.5ZM8.50004 56.5005V66.5H11.3651C10.0167 63.3467 9.04296 59.9948 8.50004 56.5005ZM12.4554 66.5C10.2335 61.4515 9.00004 55.8698 9.00004 50C9.00004 44.1302 10.2335 38.5486 12.4554 33.5H31.218C27.3473 37.9026 25 43.6772 25 50C25 56.3229 27.3473 62.0975 31.218 66.5H12.4554ZM33.5 88.6349V91.5H43.4996C40.0053 90.9571 36.6534 89.9834 33.5 88.6349ZM56.5005 91.5H66.5V88.6349C63.3467 89.9834 59.9948 90.9571 56.5005 91.5ZM66.5 87.5446C61.4515 89.7665 55.8698 91 50 91C44.1302 91 38.5486 89.7665 33.5 87.5446V68.7821C37.9026 72.6528 43.6772 75 50 75C56.3229 75 62.0975 72.6528 66.5 68.7821V87.5446ZM87.5446 66.5H68.7821C72.6528 62.0975 75 56.3229 75 50C75 43.6772 72.6528 37.9026 68.7821 33.5H87.5446C89.7665 38.5486 91 44.1302 91 50C91 55.8698 89.7665 61.4515 87.5446 66.5ZM88.6349 66.5H91.5V56.5005C90.9571 59.9948 89.9834 63.3467 88.6349 66.5ZM33.5759 32.5C37.8692 28.4691 43.6463 26 50 26C56.3538 26 62.1309 28.4691 66.4242 32.5H33.5759ZM32.5 66.4242C28.4691 62.1309 26 56.3538 26 50C26 43.6463 28.4691 37.8692 32.5 33.5759V66.4242ZM66.4242 67.5C62.1309 71.531 56.3538 74 50 74C43.6463 74 37.8692 71.531 33.5759 67.5H66.4242ZM67.5 33.5759C71.531 37.8692 74 43.6463 74 50C74 56.3538 71.531 62.1309 67.5 66.4242V33.5759Z" fill="white"/>
                </g>
              </svg>
            </div>
          </div>
          <h3 class="text-center text-white my-2">Login with Umbrel</h3>

          <div v-if="app">
            <p v-if="!showOtpInput" class="text-white text-center">Enter your Umbrel password to open {{ app.name }}</p>
            <p v-else class="text-white text-center">Enter your two-factor authentication code</p>
          </div>

          <form
            v-if="!showOtpInput"
            v-on:submit.prevent="authenticateUser"
            class="form-container mt-4 d-flex flex-column w-100 align-items-center justify-content-center"
          >
            <div class="w-100 position-relative mb-3">
              <input-password
                v-model="password"
                ref="password"
                placeholder="Password"
                inputGroupClass="glass-input-group"
                inputClass="glass-input w-100"
                :disabled="isLoggingIn"
              />
              <transition name="fade">
                <small class="text-white login-error" v-show="isIncorrectPassword">Incorrect password</small>
              </transition>
            </div>
            <b-button
              variant="default"
              type="submit"
              class="my-4 px-4 login-button bg-white font-weight-bold"
              :class="{ 'loading-fade-blink': isLoggingIn }"
              :disabled="isLoggingIn"
              pill
            >Log in</b-button>
          </form>

          <form
            v-else
            v-on:submit.prevent
            class="form-container mt-3 mb-5 d-flex flex-column w-100 align-items-center"
          >
            <div class="w-100 position-relative">
              <input-otp-token
                autofocus
                inputClass="glass-input"
                :disabled="isLoggingIn"
                :success="isCorrectOtp"
                :error="isIncorrectOtp"
                @otpToken="authenticateUserWithOtp"
                @keyup="hideOtpError"
              />
              <transition name="fade">
                <small class="mt-2 text-white login-error" v-show="isIncorrectOtp">Incorrect code</small>
              </transition>
            </div>
          </form>

          <form
            v-if="redirect"
            method="POST"
            :action="redirect.url"
            ref="redirectForm"
          >
              <input type="hidden" v-for="(value, key) in redirect.params" :name="key" :value="value" :key="key">
          </form>
        </div>
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

import delay from "@/helpers/delay";

import InputPassword from "@/components/Utility/InputPassword";
import InputOtpToken from "@/components/Utility/InputOtpToken";
import Logo from '@/components/Logo.vue';

export default {
  data() {
    return {
      password: "",
      isIncorrectPassword: false,
      isLoggingIn: false,
      otpToken: "",
      showOtpInput: false,
      isCorrectOtp: false,
      isIncorrectOtp: false
    };
  },
  watch: {
    password: function() {
      //bring up log in button after user retries new password after failed attempt
      this.isIncorrectPassword = false;
    }
  },
  computed: {
    ...mapState({
      app: state => state.apps.app,
      redirect: state => state.user.redirect
    })
  },
  methods: {
    async authenticateUser() {
      this.isLoggingIn = true;

      try {
        await this.$store.dispatch("user/login", { password: this.password, otpToken: this.otpToken });
      } catch (error) {
        this.isLoggingIn = false;
        if (error.response && error.response.data === "Incorrect password") {
          this.isIncorrectPassword = true;
          return;
        }
        if (error.response && error.response.data === "Missing OTP token") {
          return this.showOtpInput = true;
        }
        if (error.response && error.response.data === "Invalid OTP token") {
          return this.isIncorrectOtp = true;
        }
        if (error.response && error.response.data) {
          return this.$bvToast.toast(error.response.data, {
            title: "Error",
            autoHideDelay: 3000,
            variant: "danger",
            solid: true,
            toaster: "b-toaster-bottom-right"
          });
        }
        return;
      }

      if (this.otpToken) {
        // show ripple animation
        this.isCorrectOtp = true;
        await delay(1000);
      }

      this.$refs.redirectForm.submit();
    },
    authenticateUserWithOtp(otpToken) {
      this.otpToken = otpToken;
      this.authenticateUser();
    },
    hideOtpError() {
      this.isIncorrectOtp = false;
    }
  },
  components: {
    InputPassword,
    InputOtpToken,
    Logo
  }
};
</script>

<style lang="scss" scoped>
.card-glass {
  width: calc(100% - 20px);
  max-width: 440px;
  background: rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(40px) saturate(110%);

  // For firefox and Tor browser
  @supports not (backdrop-filter: blur(40px)) {
    background: rgba(0, 0, 0, 0.5);
  }
}

.top-icons-container {
  text-align: center;
  transform: translate3d(0, -50%, 0);

  .logo {
    background-color: #5351FB;
    border-radius: 22px;
    padding: 14px;
  }

  .divider {
    display: inline-block;
    vertical-align: bottom;
    height: 68px;
    width: 20%;
    border-top: 2px dashed rgba(204, 204, 204, 0.5);
  }

  .icon {
    width: 90px;
    height: 90px;
    border-radius: 20px;
  }

  #app-icon-container {
    display: inline-block;
    vertical-align: bottom;
    position: relative;
    height: 90px;
    width: 90px;

    .installed-app-icon-frame {
      position: absolute;
      top: 0px;
      left: 0px;
      z-index: -1;
      border: solid 1px #ffffff;
      border-radius: 20px;
      opacity: 0.5;
    }
  }
}

.login-button {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}

.login-error {
  position: absolute;
  bottom: -30px;
  left: 0;
  width: 100%;
  text-align: center;
}

.logo {
  height: 20vh;
  max-height: 200px;
  width: auto;
}

.incorrect-password {
  animation: shake 1s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  perspective: 1000px;
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

.loading-fade-blink {
  animation: loadingFadeBlink 1s infinite linear;
}

@keyframes loadingFadeBlink {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 0.3;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: transform 0.8s, opacity 0.8s ease;
}
.fade-enter-active {
  transition-delay: 0.4s;
}
.fade-enter,
.fade-leave-to {
  transform: translate3d(0, -20px, 0);
  opacity: 0;
}
.fade-enter-to,
.fade-leave {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
</style>

