<template>
  <transition name="checkmark-animation" appear>
    <div class="checkmark" :class="danger ? `checkmark-danger` : ''">
      <svg
        width="54"
        height="43"
        viewBox="0 0 54 43"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="checkmark-icon"
        v-if="success"
      >
        <path
          d="M47.657 1.26266C48.9446 -0.245227 51.2166 -0.428585 52.7315 0.853121C54.2464 2.13483 54.4306 4.39624 53.1429 5.90413L22.543 41.7374C21.2351 43.2689 18.9176 43.4303 17.4083 42.0948L1.20832 27.7615C-0.27769 26.4468 -0.411537 24.1818 0.909365 22.7027C2.23027 21.2236 4.50572 21.0903 5.99173 22.4051L19.4408 34.3045L47.657 1.26266Z"
          fill="white"
        />
      </svg>
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="checkmark-icon"
        v-else-if="danger"
      >
        <path
          d="M0.828729 0.82797C-0.274715 1.93193 -0.274714 3.7218 0.82873 4.82576L17.5344 21.5393L0.827583 38.2539C-0.275861 39.3579 -0.275861 41.1477 0.827583 42.2517C1.93103 43.3557 3.72006 43.3556 4.82351 42.2517L21.5303 25.537L38.2369 42.2514C39.3403 43.3554 41.1294 43.3554 42.2328 42.2514C43.3362 41.1474 43.3362 39.3576 42.2328 38.2536L25.5263 21.5393L42.2317 4.82605C43.3351 3.72209 43.3351 1.93222 42.2317 0.828259C41.1282 -0.275701 39.3392 -0.2757 38.2357 0.828259L21.5303 17.5415L4.82465 0.82797C3.72121 -0.27599 1.93217 -0.27599 0.828729 0.82797Z"
          fill="white"
        />
      </svg>
    </div>
  </transition>
</template>

<script>
export default {
  props: {
    success: {
      type: Boolean,
      default: false
    },
    danger: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {};
  },
  computed: {},
  methods: {},
  components: {}
};
</script>

<style lang="scss" scoped>
// big circle checkmark on successful send
.checkmark {
  display: block;
  position: relative;
  width: 150px;
  height: 150px;
  margin-left: auto;
  margin-right: auto;
  &:before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    transform: translate3d(-50%, -50%, 0) scale(1); //animated
    transition: transform 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    background: #00cd98;
    box-shadow: 0px 10px 30px rgba(209, 213, 223, 0.5);
    border-radius: 50%;
    z-index: 0;
  }
  &.checkmark-danger:before {
    background: #f46e6e;
  }
  .checkmark-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate3d(-50%, -50%, 0) scale(1); //animated
    transition: transform 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
}

.checkmark-animation-enter-active {
  &.checkmark {
    .checkmark-icon {
      transition-delay: 0.3s;
    }
  }
}
.checkmark-animation-enter {
  opacity: 0;
  &.checkmark {
    &:before {
      transform: translate3d(-50%, -50%, 0) scale(0);
    }
    .checkmark-icon {
      transform: translate3d(-50%, -50%, 0) scale(0);
    }
  }
}

.checkmark-animation-enter-to {
  opacity: 1;
  &.checkmark {
    &:before {
      transform: translate3d(-50%, -50%, 0) scale(1);
    }
    .checkmark-icon {
      transform: translate3d(-50%, -50%, 0) scale(1);
    }
  }
}

.checkmark-animation-leave {
  opacity: 1;
  &.checkmark {
    &:before {
      transform: translate3d(-50%, -50%, 0) scale(1);
    }
    .checkmark-icon {
      transform: translate3d(-50%, -50%, 0) scale(1);
    }
  }
}

.checkmark-animation-leave-to {
  opacity: 0;
  &.checkmark {
    &:before {
      transform: translate3d(-50%, -50%, 0) scale(0);
    }
    .checkmark-icon {
      transform: translate3d(-50%, -50%, 0) scale(0);
    }
  }
}
</style>
