<template>
  <div class="wallpaper-container p-3 p-md-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <div @click="close" class="wallpaper-close-btn cursor-pointer d-flex justify-content-center align-items-center">
        <svg class="" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M3.41421 0.585786C2.63316 -0.195262 1.36684 -0.195262 0.585786 0.585786C-0.195262 1.36684 -0.195262 2.63316 0.585786 3.41421L5.96528 8.7937L0.585872 14.1731C-0.195177 14.9542 -0.195177 16.2205 0.585872 17.0015C1.36692 17.7826 2.63325 17.7826 3.4143 17.0015L8.7937 11.6221L14.1731 17.0015C14.9542 17.7826 16.2205 17.7826 17.0015 17.0015C17.7826 16.2205 17.7826 14.9542 17.0015 14.1731L11.6221 8.7937L17.0016 3.41421C17.7827 2.63316 17.7827 1.36684 17.0016 0.585786C16.2206 -0.195262 14.9542 -0.195262 14.1732 0.585786L8.7937 5.96528L3.41421 0.585786Z" fill="black" fill-opacity="0.7"/>
        </svg>
      </div>
      <h2 class="text-lowercase wallpaper-heading">Wallpaper</h2>
    </div>
    <transition name="wallpaper-list">
      <ul class="wallpaper-list p-0 m-0 d-flex flex-wrap justify-content-start">
        <li class="wallpaper-selector cursor-pointer"
          v-for="wallpaper in wallpapers"
          @click="selectWallpaper(wallpaper)"
        :key="wallpaper">
          <figure class="wallpaper-img-container mb-0">
            <img class="wallpaper-img" :src="`/wallpapers/${wallpaper}`" draggable="false" >
          </figure>
        </li>
      </ul>
    </transition>
  </div>
</template>

<script>
export default {
  props: {},
  data() {
    return {
      wallpapers: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg', '10.jpg', '11.jpg', '12.jpg', '13.jpg', '14.jpg', '15.jpg', '16.jpg']
    };
  },
  computed: {},
  methods: {
    selectWallpaper(wallpaper) {
      this.$store.dispatch("user/setWallpaper", wallpaper);
    },
    close() {
      this.$emit("close");
    }
  },
  components: {}
};
</script>

<style lang="scss" scoped>
.wallpaper-container {
  width: 70vw;
  max-width: 600px;
  height: 100%;
  z-index: 9999;
  position: fixed;
  top: 0;
  right: 0;
  background-color: var(--wallpaper-container-background-color);
  backdrop-filter: blur(40px) saturate(180%);
  box-shadow: -10px 0px 100px rgba(0, 0, 0, 0.3);
  border-left: solid 2px var(--wallpaper-container-border-color);
  overflow-y: scroll;
  .wallpaper-heading {
    color: var(--wallpaper-heading-color);
  }
  .wallpaper-close-btn {
    background: var(--wallpaper-close-button-background-color);
    width: 30px;
    height: 30px;
    border-radius: 15px;
    transition: transform 0.3s ease-in-out;
    svg {
      height: 10px;
      widows: 10px;
      path {
        fill: var(--wallpaper-close-button-icon-color);
      }
    }
    &:hover {
      transform: scale3d(1.1, 1.1, 1.1);
    }
  }
  
  .wallpaper-list {
    list-style: none;
    column-gap: 30px;
    row-gap: 30px;
    .wallpaper-selector {
      width: calc(50% - 15px);
      transition: transform 0.4s, opacity 0.4s ease;
      .wallpaper-img-container {
        overflow: hidden;
        border-radius: 8%;
        box-shadow: 2px 2px 14px rgba(0, 0, 0, 0.2);
        transition: transform 0.4s, box-shadow 0.4s ease;
        transform: scale3d(1, 1, 1);
        aspect-ratio: 4 / 3;
        background: rgba(0, 0, 0, 0.4);
        .wallpaper-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transform: scale3d(1, 1, 1);
          transition: transform 0.4s linear;
        }
      }
      &:hover {
        .wallpaper-img-container {
          box-shadow: 2px 2px 30px rgba(0, 0, 0, 0.4);
          transform: scale3d(1.04, 1.04, 1.04);
          .wallpaper-img {
            transition: transform 7s linear;
            transform: scale3d(1.4, 1.4, 1.4);
          }
        }
      }
    }
  }
}

// Wallpaper menu transitions
.wallpaper-menu-transition-enter-active,
.wallpaper-menu-transition-leave-active {
  transition: transform 0.8s, opacity 0.4s cubic-bezier(.99,-0.13,.42,.93);
  .wallpaper-close-btn {
    transition: transform 0.4s, opacity 0.4s ease;
  }
}

.wallpaper-menu-transition-enter {
  transform: translate3d(110%, 0, 0);
  opacity: 1;
  .wallpaper-selector {
    opacity: 0;
    transform: scale3d(0.8, 0.8, 0.8);
  }
  .wallpaper-close-btn {
    opacity: 0;
    transform: scale3d(0.5, 0.5, 0.5);
  }
}

.wallpaper-menu-transition-enter-to {
  transform: translate3d(0, 0, 0);
  opacity: 1;
  .wallpaper-close-btn {
    opacity: 1;
    transform: scale3d(1, 1, 1);
    transition-delay: 0.6s;
  }
  @for $i from 1 through 17 {
    .wallpaper-selector:nth-child(#{$i}) {
      opacity: 1;
      transform: scale3d(1, 1, 1);
      transition-delay: #{($i * 100ms)};
    }
  }
}

.wallpaper-menu-transition-leave {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
.wallpaper-menu-transition-leave-to {
  transform: translate3d(120%, 0, 0);
  opacity: 1;
  .wallpaper-close-btn {
    opacity: 0;
    transform: scale3d(0.5, 0.5, 0.5);
  }
}
</style>
