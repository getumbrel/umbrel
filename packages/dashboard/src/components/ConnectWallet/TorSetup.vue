<template>
  <div class="px-3 pb-2">
    <p class="font-weight-bold">How to install Tor on your system</p>
    <b-form-select v-model="selectedOS" class="mb-3">
      <b-form-select-option :value="null" disabled
        >Select your OS</b-form-select-option
      >
      <b-form-select-option value="macOS">macOS</b-form-select-option>
      <b-form-select-option value="Linux">Linux</b-form-select-option>
      <b-form-select-option value="Windows">Windows</b-form-select-option>
    </b-form-select>

    <ol class="pl-3" v-if="selectedOS == 'macOS'">
      <li class="mb-3">
        Open the "Terminal" app on your Mac and install
        <a href="https://brew.sh/" target="_blank">Homebrew</a> by running:
        <input-copy
          class="mt-2"
          value='/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)"'
          size="sm"
        ></input-copy>
      </li>

      <li class="mb-3">
        Install Tor by running:
        <input-copy
          class="mt-2"
          value="brew install tor"
          size="sm"
        ></input-copy>
      </li>
    </ol>

    <ol class="pl-3" v-else-if="selectedOS == 'Linux'">
      <li class="mb-3">
        Open Terminal and install Tor:
        <input-copy
          class="mt-2"
          value="sudo apt-get install tor"
          size="sm"
        ></input-copy>
      </li>
    </ol>

    <ol class="pl-3" v-else-if="selectedOS == 'Windows'">
      <li class="mb-3">
        Download Tor "Windows Expert Bundle" from
        <a target="_blank" href="https://www.torproject.org/download/tor/">here</a>.
      </li>
      <li class="mb-3">
        Unzip the file, open the "Tor" folder inside it and install "tor.exe"
      </li>
    </ol>
  </div>
</template>

<script>
import InputCopy from "@/components/Utility/InputCopy.vue";

export default {
  props: {
    selectedOS: {
      type: String,
      default: null
    }
  },
  data() {
    return {};
  },
  computed: {},
  methods: {},
  components: {
    InputCopy
  }
};
</script>

<style lang="scss" scoped></style>
