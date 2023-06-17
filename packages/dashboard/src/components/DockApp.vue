<template>
  <div class="dock-app-container cursor-pointer d-flex justify-content-center align-items-center"
    :class="{'bounce': bounceIcon, 'dock-app-container-left': position === 'left', 'dock-divider': id === 'mode'}"
    @click="onClick"
    >
    <div class="dock-app" :class="{'dock-app-active': active}">
      <span class="dock-app-name d-flex justify-content-center align-items-center">{{ name }}</span>
      <div class="dock-app-icon-container">
        <slot name="icon" v-if="this.$slots.icon"></slot>
        <img v-else class="dock-app-icon" :src="require(`@/assets/dock/${id}.png`)" alt="" draggable="false">
        <transition name="grow-transition">
            <span v-if="notifications" class="dock-app-notification text-white text-center" :class="{'dock-app-notification-xl' : notifications > 9}">
              {{ notifications }}
            </span>
        </transition>
      </div>
    </div>
  </div>
</template>

<script>
import delay from "@/helpers/delay";

export default {
  data() {
    return {
      bounceIcon: false
    };
  },
  props: {
    id: String,
    name: String,
    position: String, 
    notifications: {
      type: Number,
      default: 0
    },
    active: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    onClick() {
      this.$emit("click");
      this.bounceIcon = true;
      delay(700).then(() => {
        this.bounceIcon = false;
      });
    }
  },
};
</script>

<style lang="scss" scoped>
.dock-app-container {
  position: relative;
  padding: 0 6px;

  &.dock-divider {
    .dock-app-name {
      transform: translate3d(calc(-50% + 6px), 0, 0);
    }
    &:before {
      content: "";
      display: block;
      width: 2px;
      height: 60px;
      padding: 0 6px;
      border-left: 2px solid var(--dock-divider-color);
    }
  }

  .dock-app {
    &:after {
      content: "";
      position: absolute;
      width: 5px;
      height: 5px;
      bottom: -8px;
      left: 50%;
      transform: translate3d(-2.5px, 0, 0);
      border-radius: 2.5px;
      background-color: rgba(255, 255, 255, 0.5);
      opacity: 0;
      transition: opacity 0.1s ease;
    }
    &.dock-app-active:after {
      opacity: 1;
    }
  }

  .dock-app-name {
    position: absolute;
    top: -70px;
    left: 50%;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.7);
    color: rgba(255, 255, 255, 1);
    padding: 4px 15px;
    border-radius: 6px;
    font-size: 0.9rem;
    visibility: hidden;
    transform: translate3d(-50%, 0, 0);
    &:after {
      content: "";
      position: absolute;
      bottom: -10px;
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid rgba(0, 0, 0, 0.7);
    }
  }

  .dock-app-icon-container {

    .dock-app-icon,
    svg {
      width: 60px;
      height: 60px;
      transition: transform 0.2s ease, width 0.2s ease, height 0.2s ease, margin 0.2s ease;
    }
    .dock-app-icon {
      object-fit: cover;
      border-radius: 8px;
      // box-shadow: 0 0 6px rgb(0 0 0 / 10%);
    }
    .dock-app-notification {
      position: absolute;
      top: -7px;
      right: 0px;
      height: 26px;
      width: 26px;
      background: #FF4E4E;
      border-radius: 13px;
      box-shadow: -4px 4px 4px rgba(0, 0, 0, 0.1);
      font-size: 15px;
      line-height: 25px;
      margin: 0;
      transition: transform 0.2s, opacity 0.4s ease;
      &.dock-app-notification-xl {
        width: 34px;
      }
    }
  }

  &:active {
    .dock-app-icon {
      filter: brightness(0.5)   
    }
  }

  &.bounce {
    animation: bounce-vertical 0.6s ease;
  }

  &.bounce:before {
    animation: bounce-vertical-reverse 0.6s ease;
  }

  &.dock-app-container-left {
    display: flex;
    flex-direction: column;
    padding: 6px 0;

    &.dock-divider {
      .dock-app-name {
        transform: translate3d(0, calc(-50% + 6px), 0);
      }
      &:before {
        content: "";
        display: block;
        width: 60px;
        height: 2px;
        padding: 6px 0;
        border-left: none;
        border-top: 2px solid var(--dock-divider-color);
      }
    }

    .dock-app-icon-container {
      .dock-app-notification {
        top: 0;
        right: -6px;
        transition: transform 0.2s;
      }
    }
    .dock-app {
      &:after {
        left: -8px;
        top: 50%;
        transform: translate3d(0, -2.5px, 0);
      }
    }
    .dock-app-name {
      top: 50%;
      left: 100px;
      transform: translate3d(0, -50%, 0);
      &:after {
        display: none;
      }
    }
    &.bounce {
      animation: bounce-horizontal 0.6s ease;
    }
    &.bounce:before {
      animation: bounce-horizontal-reverse 0.6s ease;
    }
  }
}

@keyframes bounce-vertical {
  0%, 100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(0, -60%, 0);
  }
  90% {
    transform: translate3d(0, 5px, 0);
  }
}

@keyframes bounce-vertical-reverse {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(0, 60%, 0);
  }
  90% {
    transform: translate3d(0, -5px, 0);
  }
}

@keyframes bounce-horizontal {
  0%, 100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(60%, 0, 0);
  }
  90% {
    transform: translate3d(-5px, 0, 0);
  }
}

@keyframes bounce-horizontal-reverse {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(-60%, 0, 0);
  }
  90% {
    transform: translate3d(5px, 0, 0);
  }
}

// enable icon hover animation and 
// name visibility on desktops only

@media (hover: hover) and (pointer: fine) {
  .dock-app-container {
    &:hover {
      .dock-app-icon-container {
        .dock-app-notification {
          transform: scale3d(1.3, 1.3, 1.3) translate3d(-1px, -17px, 0);
        }
      }

      .dock-app-icon,
      svg {
        width: 78px;
        height: 78px;
        margin-top: -20px;
        transform: translate3d(0, -5px, 0);
      }
      .dock-app-name {
        visibility: visible;
      }
    }
    &.dock-app-container-left {
      &:hover {
        .dock-app-icon-container {
          .dock-app-notification {
            transform: scale3d(1.3, 1.3, 1.3) translate3d(20px, 1px, 0);
          }
        }

        .dock-app-icon,
        svg {
          margin-top: 0;
          margin-right: -20px;
          transform: translate3d(5px, 0, 0);
          width: 78px;
          height: 78px;
        }
      }
    }
  }
}
</style>