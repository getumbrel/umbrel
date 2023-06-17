<template>
  <div v-if="!loading" class="d-flex flex-column align-items-center justify-content-center min-vh100 login-container p-2">
    <logo class="mb-3 logo" />
    <h1 class="text-center text-white text-lowercase mb-1">Welcome back</h1>
    <p v-if="!showOtpInput" class="text-white w-75 text-center">Enter the password to login to your Umbrel</p>
    <p v-else class="text-white w-75 text-center">Enter your two-factor authentication code</p>
    <form
      v-if="!showOtpInput"
      v-on:submit.prevent="authenticateUser"
      class="form-container px-3 mt-3 d-flex flex-column form-container w-100 align-items-center"
    >
      <input-password
        v-model="password"
        ref="password"
        placeholder="Password"
        :inputClass="[
          isIncorrectPassword ? 'incorrect-password' : '',
          'glass-input w-100'
        ]"
        inputGroupClass="glass-input-group"
        :disabled="isLoggingIn"
      />
      <div class="login-button-container">
        <transition name="slide-up-fade-transition">
          <small class="mt-2 text-white error" v-show="isIncorrectPassword">Incorrect password</small>
        </transition>
        <transition name="slide-up-transition">
          <b-button
            variant="default"
            type="submit"
            class="px-4 login-button bg-white font-weight-bold"
            :class="{ 'fade-in-out': isLoggingIn }"
            v-show="!!password && !isIncorrectPassword"
            :disabled="isLoggingIn"
            pill
          >Log in</b-button>
        </transition>
      </div>
    </form>

    <form
      v-else
      v-on:submit.prevent
      class="form-container mt-3 d-flex flex-column form-container w-100 align-items-center"
    >
      <input-otp-token
        autofocus
        inputClass="glass-input"
        :disabled="isLoggingIn"
        :success="isCorrectOtp"
        :error="isIncorrectOtp"
        @otpToken="authenticateUserWithOtp"
        @keyup="hideOtpError"
      />
      <div class="login-button-container">
        <transition name="fade">
          <small class="mt-2 text-white error" v-show="isIncorrectOtp">Incorrect code</small>
        </transition>
      </div>
    </form>
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
      loading: true,
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
      jwt: state => state.user.jwt,
      registered: state => state.user.registered
    })
  },
  async created() {
    //redirect to dashboard if already logged in
    if (this.jwt) {
      this.$router.push({name: 'home'});
    }

    //redirect to onboarding if the user is not registered
    await this.$store.dispatch("user/registered");

    if (!this.registered) {
      return this.$router.push({name: 'start'});
    }

    this.loading = false;
    this.selectPasswordInput();
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
          this.selectPasswordInput();
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

      try {
        await Promise.all([
          this.$store.dispatch("user/getInfo"),
          this.$store.dispatch("apps/getInstalledApps")
        ]);
      } catch (error) {
          // do nothing
      }
      
      // redirect to home
      return this.$router.push(
        this.$router.history.current.query.redirect || {name: 'home'}
      );
    },
    selectPasswordInput() {
      this.$nextTick(() => this.$refs.password.$el.querySelector('input').select());
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

<style lang="scss">
.logo {
  height: 18vh;
  max-height: 200px;
  width: auto;
}
.form-container {
  max-width: 400px;
}
.login-button-container {
  position: relative;
  padding-top: 5rem;
  width: 100%;
  .error {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    text-align: center;
  }
  .login-button {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translate3d(-50%, 0, 0);
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }
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

.login-button-container {
  .login-button {
    &.slide-up-transition-enter-active,
    &.slide-up-transition-leave-active {
      transition: transform 0.8s, opacity 0.8s ease;
    }
    &.slide-up-transition-enter {
      transform: translate3d(-50%, 10px, 0);
      opacity: 0;
    }
    &.slide-up-transition-enter-to {
      transform: translate3d(-50%, 0, 0);
      opacity: 1;
    }
    &.slide-up-transition-leave {
      transform: translate3d(-50%, 0, 0);
      opacity: 1;
    }
    &.slide-up-transition-leave-to {
      transform: translate3d(-50%, 10px, 0);
      opacity: 0;
    }
  }
}

.slide-up-fade-transition-enter-active,
.slide-up-fade-transition-leave-active {
  transition: transform 0.8s, opacity 0.8s ease;
}
.slide-up-fade-transition-enter-active {
  transition-delay: 0.4s;
}
.slide-up-fade-transition-enter,
.slide-up-fade-transition-leave-to {
  transform: translate3d(0, -20px, 0);
  opacity: 0;
}
.slide-up-fade-transition-enter-to,
.slide-up-fade-transition-leave {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
</style>
