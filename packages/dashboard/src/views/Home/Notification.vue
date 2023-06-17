<template>
  <div class="d-flex justify-content-center w-100 px-2">
    <b-alert class="w-100 alert-sm alert-pill" variant="glass" :show="true" dismissible>
      <div class="w-100 d-flex justify-content-between">
        <div class="d-flex align-items-center">
          <b-icon icon="bell-fill" class="mr-2 d-none d-sm-block"></b-icon>
          <span>{{ text }}</span>
        </div>
        <!-- Slot for action button  -->
        <slot></slot>
      </div>
      <template v-slot:dismiss :class="['sm']" pill>
        <svg class="" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M3.41421 0.585786C2.63316 -0.195262 1.36684 -0.195262 0.585786 0.585786C-0.195262 1.36684 -0.195262 2.63316 0.585786 3.41421L5.96528 8.7937L0.585872 14.1731C-0.195177 14.9542 -0.195177 16.2205 0.585872 17.0015C1.36692 17.7826 2.63325 17.7826 3.4143 17.0015L8.7937 11.6221L14.1731 17.0015C14.9542 17.7826 16.2205 17.7826 17.0015 17.0015C17.7826 16.2205 17.7826 14.9542 17.0015 14.1731L11.6221 8.7937L17.0016 3.41421C17.7827 2.63316 17.7827 1.36684 17.0016 0.585786C16.2206 -0.195262 14.9542 -0.195262 14.1732 0.585786L8.7937 5.96528L3.41421 0.585786Z" fill="white" fill-opacity="1"/>
        </svg>
      </template>
    </b-alert>
  </div>
</template>

<script>
export default {
  props: {
    text: String
  },
  data() {
    return {};
  },
  computed: {},
  methods: {},
  components: {}
};
</script>

<style lang="scss" scoped></style>
