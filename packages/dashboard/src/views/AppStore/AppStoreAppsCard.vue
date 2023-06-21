<template>
  <div v-if="apps.length">
    <card-widget class="py-3">
      <div class="mb-1 mb-sm-3 px-3 px-xl-4">
        <div class="mb-1">
          <small v-if="subtitle" class="text-muted text-uppercase">
            {{ subtitle }}
          </small>
        </div>
        <h2 class="text-title-color title-card mb-0">
          {{ title }}
        </h2>
      </div>
      <div class="app-store-card-columns">
        <router-link
          :to="{name: 'app-store-app', params: {id: app.id}}"
          v-for="app in apps"
          :key="app.id"
          class="app-store-app-link d-flex px-3 px-xl-4 py-3"
        >
          <div class="d-flex">
            <div class="d-block">
              <img
                class="app-icon mr-2"
                :src="app.icon"
                draggable="false"
              />
            </div>
            <div class="d-flex flex-column">
              <h4 class="app-name text-title-color mt-1 mb-0">
                {{ app.name }}
                <span v-if="app.optimizedForUmbrelHome" v-b-tooltip.hover title="Optimized for Umbrel Home" style="vertical-align: text-bottom;">
                  <svg class="optimized-for-umbrel-home-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12.5 6.5L10 4M10.5 10.5L5 5M6.5 12.5L4 10M9 15L13 13L15 9L17 13L21 15L17 17L15 21L13 17L9 15Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </h4>
              <p class="app-tagline text-muted mb-0">
                {{ app.tagline }}
              </p>
            </div>
          </div>
        </router-link>
      </div>
    </card-widget>
  </div>
</template>

<script>
import CardWidget from "@/components/CardWidget";

export default {
  props: {
    apps: Array,
    title: String,
    subtitle: {
      type: String,
      default: ""
    }
  },
  data() {
    return {};
  },
  components: {
    CardWidget
  },
};
</script>

<style lang="scss" scoped>
.title-card {
  font-size: 2.5rem;
}
.app-name {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  font-weight: 500;
}
.app-tagline {
  font-size: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.3;
  margin-top: 0.2rem;
}
</style>
