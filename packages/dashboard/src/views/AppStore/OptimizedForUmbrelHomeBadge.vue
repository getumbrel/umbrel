<template>
   <b-badge pill class="px-2" :class="badgeClass" variant="glass">
    <svg class="optimized-for-umbrel-home-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12.5 6.5L10 4M10.5 10.5L5 5M6.5 12.5L4 10M9 15L13 13L15 9L17 13L21 15L17 17L15 21L13 17L9 15Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    &nbsp;Optimized for Umbrel Home
  </b-badge>
</template>

<script>
export default {
  props: {
    badgeClass: {
      type: String,
      default: ""
    }
  }
};
</script>

<style lang="scss" scoped></style>
