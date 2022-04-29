<template>
  <b-input-group :class="inputGroupClass">
    <!-- Todo: make it work with b-form-input + v-model -->
    <input
      :class="inputClass"
      :placeholder="placeholder"
      :type="showPassword ? 'text' : 'password'"
      v-bind:value="value"
      v-on:input="$emit('input', $event.target.value)"
      :disabled="disabled"
    />
    <b-input-group-append>
      <b-button @click="togglePassword" :disabled="disabled">
        <b-icon :icon="showPassword ? 'eye-slash-fill' : 'eye-fill'"></b-icon>
      </b-button>
    </b-input-group-append>
  </b-input-group>
</template>

<script>
export default {
  props: {
    value: String,
    inputClass: [String, Array],
    inputGroupClass: {
      type: String,
      default: "card-input-group"
    },
    placeholder: String,
    disabled: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    showPassword() {
      return this.state.showPassword;
    }
  },
  data() {
    return {
      state: {
        showPassword: false
      }
    };
  },
  methods: {
    togglePassword() {
      return (this.state.showPassword = !this.state.showPassword);
    }
  }
};
</script>

<style lang="scss" scoped></style>
