<template>
  <div>
    <span
      class="word-count d-block mx-auto bg-primary text-white text-center mb-2"
      >{{ index + 1 }}</span
    >
    <div class="d-flex align-items-center">
      <button
        class="btn-neu-circle btn-neu-circle-previous btn-neu"
        :disabled="index === 0"
        @click="previous"
      >
        <svg
          width="12"
          height="20"
          viewBox="0 0 12 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M11.2519 17.4986C11.8051 18.0518 11.8051 18.9488 11.2519 19.5021C10.6987 20.0553 9.80167 20.0553 9.24843 19.5021L0.748431 11.0021C0.212111 10.4657 0.193346 9.60216 0.705864 9.04305L8.49753 0.543046C9.02622 -0.0337055 9.92236 -0.0726672 10.4991 0.456022C11.0759 0.984712 11.1148 1.88085 10.5861 2.4576L3.71103 9.95772L11.2519 17.4986Z"
            fill="#C3C6D1"
          />
        </svg>
      </button>
      <div class="d-block word-container">
        <div class="px-3" v-if="recover">
          <b-form-input
            v-model="inputWords[index]"
            ref="input-words-input"
            :placeholder="`Enter word #${index + 1}`"
            class="neu-input"
            autofocus
            size="lg"
            @keyup.enter="next"
          ></b-form-input>
        </div>
        <h2 class="text-center mb-0" v-else>
          <scrambled-text :text="words[index]"></scrambled-text>
        </h2>
      </div>
      <button
        class="btn-neu-circle btn-neu-circle-next btn-neu"
        :class="{ 'btn-allowed': index > 0 }"
        @click="next"
        :disabled="index === words.length - 1"
      >
        <svg
          width="12"
          height="20"
          viewBox="0 0 12 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0.748099 2.50141C0.194857 1.94817 0.194857 1.05118 0.748099 0.49794C1.30134 -0.0553029 2.19833 -0.0553029 2.75157 0.49794L11.2516 8.99794C11.7879 9.53426 11.8067 10.3978 11.2941 10.957L3.50247 19.457C2.97378 20.0337 2.07764 20.0727 1.50089 19.544C0.924139 19.0153 0.885176 18.1192 1.41387 17.5424L8.28897 10.0423L0.748099 2.50141Z"
            fill="#C3C6D1"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
import ScrambledText from "@/components/Utility/ScrambledText";

export default {
  props: {
    words: Array,
    recover: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      index: 0,
      inputWord: "",
      inputWords: [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ]
    };
  },
  computed: {},
  methods: {
    previous() {
      if (this.index !== 0) {
        this.index -= 1;
        // Autofocus input field if user is recovering
        if (this.recover) {
          this.$refs["input-words-input"].focus();
        }
      }
    },
    next() {
      if (this.index < this.words.length - 1) {
        this.index += 1;
        // Autofocus input field if user is recovering
        if (this.recover) {
          this.$refs["input-words-input"].focus();
        }
        // Emit "complete" on reaching the last word
        else if (this.index === this.words.length - 1) {
          this.$emit("complete");
        }
      }
    }
  },
  mounted() {},
  watch: {
    inputWords: function() {
      // Emit "complete" if user has entered all recovery words
      if (
        this.inputWords.length === 24 &&
        !this.inputWords.includes(undefined) &&
        !this.inputWords.includes("")
      ) {
        this.$emit("complete");
      } else {
        this.$emit("incomplete");
      }
      // Emit entered words
      this.$emit("input", this.inputWords);
    }
  },
  components: {
    ScrambledText
  }
};
</script>

<style lang="scss" scoped>
.word-count {
  height: 3rem;
  width: 3rem;
  line-height: 3rem;
  border-radius: 50%;
}
.word-container {
  width: 350px;
}

.btn-neu-circle {
  height: 5rem;
  width: 5rem;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0px 5px 15px rgba(143, 149, 163, 0.25) !important;
  transition: box-shadow 0.5s, opacity 0.5s, transform 0.5s ease;
  &:not([disabled]) {
    &:hover {
      box-shadow: 0px 5px 30px rgba(143, 149, 163, 0.35) !important;
      &.btn-neu-circle-next:not([disabled]) {
        transform: translateX(3px);
      }
      &.btn-neu-circle-previous:not([disabled]) {
        transform: translateX(-3px);
      }
    }
    &:active {
      &.btn-neu-circle-next:not([disabled]) {
        svg {
          transform: translateX(5px);
        }
      }
      &.btn-neu-circle-previous:not([disabled]) {
        svg {
          transform: translateX(-5px);
        }
      }
    }
  }
  &[disabled] {
    opacity: 0;
  }
  svg {
    transition: transform 0.5s ease;
  }
}

.btn-disabled {
  cursor: not-allowed;
}

@media screen and (max-width: 767px) {
  .word-container {
    width: 250px;
  }
  .btn-neu-circle {
    height: 3rem;
    width: 3rem;
  }
}
</style>
