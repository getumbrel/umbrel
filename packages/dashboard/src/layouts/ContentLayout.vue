<template>
  <transition :name="isMobileDevice ? 'mobile-content-container-transition' : 'content-container-transition'" mode="out-in" appear>
    <div id="content-container" class="content-container">
      <div class="header">
        <router-link :to="{name: 'home'}"
          class="btn-close-page cursor-pointer"
        >
          <svg class="" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M3.41421 0.585786C2.63316 -0.195262 1.36684 -0.195262 0.585786 0.585786C-0.195262 1.36684 -0.195262 2.63316 0.585786 3.41421L5.96528 8.7937L0.585872 14.1731C-0.195177 14.9542 -0.195177 16.2205 0.585872 17.0015C1.36692 17.7826 2.63325 17.7826 3.4143 17.0015L8.7937 11.6221L14.1731 17.0015C14.9542 17.7826 16.2205 17.7826 17.0015 17.0015C17.7826 16.2205 17.7826 14.9542 17.0015 14.1731L11.6221 8.7937L17.0016 3.41421C17.7827 2.63316 17.7827 1.36684 17.0016 0.585786C16.2206 -0.195262 14.9542 -0.195262 14.1732 0.585786L8.7937 5.96528L3.41421 0.585786Z" fill="white" fill-opacity="1"/>
          </svg>
        </router-link>
      </div>
      <div class="content px-1 px-sm-2 px-xl-4 mx-2">
        <transition name="change-page-transition" mode="out-in">
          <router-view :key="this.$route.path"></router-view>
        </transition>
      </div>
    </div>
  </transition>
</template>

<script>
export default {
  data() {
    return {};
  },
  props: {
    isMobileDevice: Boolean
  }
};
</script>

<style lang="scss" scoped>

.content-container {
  position: fixed;
  top: 20px;
  height: 100%;
  width: calc(100% - 20px);
  max-width: 1360px;
  border-radius: 16px;
  overflow-y: auto;
  background-color: var(--content-background-color);
  box-shadow: 0px 0px 100px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(60px) saturate(200%);
  z-index: 99;

  // optimize performance
  will-change: transform;

  // hide scrollbar
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
  
  .header {
    position: sticky;
    top: 0;
    left: 0;
    width: 100%;
    height: 0;
    z-index: 999;
    .btn-close-page {
      position: absolute;
      top: 10px;
      right: 10px;
      height: 26px;
      width: 26px;
      background-color: var(--content-close-button-background-color);
      backdrop-filter: blur(10px);
      border-radius: 50%;
      transition: transform 0.4s, opacity 0.4s ease;
      svg {
        position: absolute;
        top: 50%;
        left: 50%;
        height: 10px;
        width: 10px;
        transform: translate3d(-50%, -50%, 0);
      }
      &:hover {
        transform: scale3d(1.1, 1.1, 1.1);
      }
    }
  }
  .content {
    padding-bottom: 120px;
  }
}

// Content open/close transition
.content-container-transition-enter-active,
.content-container-transition-leave-active {
  transition: transform 0.35s cubic-bezier(.66,-0.35,.25,1.09);
}
.content-container-transition-enter {
  transform: translate3d(0, calc(50% - 90px), 0) scale3d(0, 0, 0);
}
.content-container-transition-enter-to {
  transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
}
.content-container-transition-leave {
  transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
}
.content-container-transition-leave-to {
  transform: translate3d(0, calc(50% - 90px), 0) scale3d(0, 0, 0);
}

.mobile-content-container-transition-enter-active,
.mobile-content-container-transition-leave-active {
  transition: transform 0.35s cubic-bezier(.66,0,.39,1);
}
.mobile-content-container-transition-enter {
  transform: translate3d(-55%, 0, 0) scale3d(0, 0, 0);
}
.mobile-content-container-transition-enter-to {
  transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
}
.mobile-content-container-transition-leave {
  transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
}
.mobile-content-container-transition-leave-to {
  transform: translate3d(-55%, 0, 0) scale3d(0, 0, 0);
}

// Page changing transitions
.change-page-transition-enter-active,
.change-page-transition-leave-active {
  transition: transform 0.15s, opacity 0.15s ease;
}
.change-page-transition-enter {
  transform: translate3d(30px, 0, 0);
  opacity: 0;
}
.change-page-transition-enter-to {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
.change-page-transition-leave {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
.change-page-transition-leave-to {
  transform: translate3d(-30px, 0, 0);
  opacity: 0;
}
</style>
