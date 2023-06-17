<template>
  <b-input-group
    class="copy-input-container align-items-center"
    :class="autoWidth ? 'd-inline-flex auto-width mx-1' : 'd-flex'"
    :style="{
      width: autoWidth ? `${(10 + value.toString().length) * 8}px` : width,
      maxWidth: '100%',
    }"
    :size="size ? size : 'sm'"
  >
    <b-form-input
      ref="copy-input-field"
      type="text"
      class="copy-input"
      readonly
      v-model="value"
    ></b-form-input>

    <b-input-group-append class="copy-icon-btn" @click="copyText">
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        class="copy-icon"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          v-if="!isCopied"
          fill="#C3C6D1"
          d="M10.9336 18H4.21875C2.66789 18 1.40625 16.7384 1.40625 15.1875V5.66016C1.40625 4.1093 2.66789 2.84766 4.21875 2.84766H10.9336C12.4845 2.84766 13.7461 4.1093 13.7461 5.66016V15.1875C13.7461 16.7384 12.4845 18 10.9336 18ZM4.21875 4.25391C3.44339 4.25391 2.8125 4.8848 2.8125 5.66016V15.1875C2.8125 15.9629 3.44339 16.5938 4.21875 16.5938H10.9336C11.709 16.5938 12.3398 15.9629 12.3398 15.1875V5.66016C12.3398 4.8848 11.709 4.25391 10.9336 4.25391H4.21875ZM16.5586 13.4297V2.8125C16.5586 1.26164 15.297 0 13.7461 0H5.94141C5.55304 0 5.23828 0.314758 5.23828 0.703125C5.23828 1.09149 5.55304 1.40625 5.94141 1.40625H13.7461C14.5215 1.40625 15.1523 2.03714 15.1523 2.8125V13.4297C15.1523 13.8181 15.4671 14.1328 15.8555 14.1328C16.2438 14.1328 16.5586 13.8181 16.5586 13.4297Z"
        />
        <path
          v-else
          fill="#C3C6D1"
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M4.21875 18H10.9336C12.4845 18 13.7461 16.7384 13.7461 15.1875V5.66016C13.7461 4.1093 12.4845 2.84766 10.9336 2.84766H4.21875C2.66789 2.84766 1.40625 4.1093 1.40625 5.66016V15.1875C1.40625 16.7384 2.66789 18 4.21875 18ZM16.5586 2.8125V13.4297C16.5586 13.8181 16.2438 14.1328 15.8555 14.1328C15.4671 14.1328 15.1523 13.8181 15.1523 13.4297V2.8125C15.1523 2.03714 14.5215 1.40625 13.7461 1.40625H5.94141C5.55304 1.40625 5.23828 1.09149 5.23828 0.703125C5.23828 0.314758 5.55304 0 5.94141 0H13.7461C15.297 0 16.5586 1.26164 16.5586 2.8125Z"
        />
      </svg>
    </b-input-group-append>
  </b-input-group>
</template>

<script>
export default {
  props: {
    size: {
      type: String,
      default: "sm",
    },
    value: String,
    width: {
      type: String,
      default: "auto"
    },
    autoWidth: {
      type: Boolean,
      default: false,
    }
  },
  data() {
    return {
      isCopied: false
    };
  },
  methods: {
    copyText() {
      //copy generated invoice's text to clipboard

      const copyText = this.$refs["copy-input-field"];
      copyText.select();
      copyText.setSelectionRange(0, 99999); /*For mobile devices*/
      document.execCommand("copy");

      window.setTimeout(() => {
        copyText.blur();
        window.getSelection().removeAllRanges();
        this.isCopied = false;
      }, 1000);

      return (this.isCopied = true);
    }
  },
  watch: {
    value: function() {
      this.isCopied = false;
    }
  }
};
</script>

<style lang="scss" scoped>
.copy-input-container {
  border: dashed 2px var(--input-copy-border-color);
  padding: 0.1rem 0.6rem;
  border-radius: 3px;
}
.copy-input {
  background: none;
  border: none;
  outline: none;
  box-shadow: none;
  padding-left: 0;
  padding-right: 10px;
  color: var(--text-muted-color);
}
.copy-icon-btn {
  cursor: pointer;
  svg {
    path {
      fill: var(--input-copy-border-color);
    }
  }
}
</style>
