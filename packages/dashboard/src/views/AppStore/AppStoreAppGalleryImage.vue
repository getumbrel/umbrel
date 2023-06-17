<template>
  <div
    class="app-gallery-image-container mx-2"
  >
    <img
      class="app-gallery-image-preloader"
      :class="!imageLoaded ? 'loading' : ''"
      :src="preloaderImage"
    />
    <img
      :class="!imageLoaded ? 'loading' : ''"
      class="app-gallery-image"
      :src="galleryImage"
      @load="onGalleryImageLoad"
    />
  </div>
</template>

<script>
export default {
  props: {
    preloaderImage: String,
    galleryImage: String,
  },
  data() {
    return {
      imageLoaded: false
    };
  },
  methods: {
    onGalleryImageLoad() {
      this.imageLoaded = true;
    }
  },
  components: {},
};
</script>

<style lang="scss" scoped></style>
