<template>
  <div>
    <transition name="transition-wrapper" mode="out-in">
      <router-view></router-view>
    </transition>
  </div>
</template>

<script>
export default {};
</script>

<style lang="scss" scoped>
.transition-wrapper-enter-active,
.transition-wrapper-leave-active {
  transition: opacity 0.4s ease;
}
.transition-wrapper-enter {
  opacity: 0;
}
.transition-wrapper-enter-to {
  opacity: 1;
}
.transition-wrapper-leave {
  opacity: 1;
}
.transition-wrapper-leave-to {
  opacity: 0;
}
</style>
