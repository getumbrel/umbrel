<template>
  <div class="d-flex flex-column align-items-center justify-content-center min-vh100 p-2">
    <div class="d-flex flex-column align-items-center justify-content-center">
      <logo class="mb-1" />
      <h2 class="text-white text-center mb-4">Migration Assistant</h2>
      
      <b-progress
      :value="statusForComponent.progress"
      class="mb-2 w-25 loading-progress"
      variant="light"
      :style="{ height: '4px' }"
      ></b-progress>
      
      <div class="text-center">
        <small class="text-white d-block">{{`${statusForComponent.description}...`}}</small>
        <b-alert class="alert-system" variant="glass" show>
          <div class="d-flex align-items-center">
            <small>⚠️ Do not turn off your Umbrel Home until the migration is complete</small>
          </div>
        </b-alert>
      </div>
    </div>
  </div>
</template>

<script>
import Logo from '@/components/Logo.vue';
import { mapState } from "vuex";
import delay from "@/helpers/delay";

export default {
  data() {
    return {
      statusForComponent: {
        running: false,
        progress: 0,
        description: "",
        error: false
      },
      hasJokeSquenceRun: false,
      stopMigrationSequence: false
    };
  },
  props: {},
  computed: {
    ...mapState({
      migrateStatus: state => state.system.migrateStatus
    })
  },
  created() {
    this.runMigrationSequence();
  },
  methods: {
    async runMigrationSequence() {
      while (!this.stopMigrationSequence) {
        this.statusForComponent = this.migrateStatus;

        if (this.migrateStatus.error) {
          this.$store.commit("system/setShowMigrationError", true);
        }

        // occurs even if there is a migration error
        if (this.migrateStatus.progress === 100) {
          this.stopMigrationSequence = true;
          this.statusForComponent.description = "Almost done";
          await delay(2000);
          if (!this.migrateStatus.error) {
            // only log out if migration was successful. If there is an error during migration the password has not been changed, so logging out would be additional frustration for the user attempting to try again.
            await this.$store.dispatch("user/logout");
          }
          this.$store.commit("system/setShowMigrationComplete", true);
        }

        if (!this.hasJokeSquenceRun && this.migrateStatus.description === 'Copying data') {
          this.hasJokeSquenceRun = true;
          await this.runJokeSequence();
        }

        await delay(2000);
      }
    },
    async runJokeSequence() {
      this.statusForComponent.description = "Transferring data";
      this.statusForComponent.progress = 0;
      await delay(3000);
      this.statusForComponent.description = "to Google";
      await delay(1500);
      this.statusForComponent.description = "wait, what?";
      await delay(2000);
      this.statusForComponent.description = "just kidding";
      await delay(2000);
      this.statusForComponent.description = "okay, actually transferring data";
      await delay(2000);
    }
  },
  components: {
    Logo,
  }
};
</script>

<style lang="scss" scoped>
.progress {
  background-color: rgba(255, 255, 255, 0.4) !important; 
}
.loading-progress {
  min-width: 260px;
}

.alert-system {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translate3d(-50%, 0, 0);
}
</style>
