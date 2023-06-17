<template>
  <div class="mt-2 release-notes d-flex justify-content-between">
    <p 
      class="release-notes-text text-newlines mb-0"
      :class="{'release-notes-text-open': showReleaseNotes}"
    >{{ text }}</p>
    <b-link
      v-if="!showReleaseNotes"
      href="#"
      size="sm"
      class="ml-2 primary-link d-inline-block align-self-end"
      @click.prevent="showFullReleaseNotes"
    >more</b-link>
  </div>
</template>

<script>
export default {
  props: {
    text: String
  },
  data() {
    return {
      showReleaseNotes: false,
    };
  },
  methods: {
    showFullReleaseNotes: function() {
      this.showReleaseNotes = true;
    }
  }
};
</script>

<style lang="scss" scoped>
.release-notes {
  .release-notes-text {
    height: 3rem;
    transition: height 0.4s ease;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    &.release-notes-text-open {
      height: auto;
      -webkit-line-clamp: inherit;
    }
  }
}
</style>
