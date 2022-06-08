import API from "@/helpers/api";

// Initial state
const state = () => ({
  app: null
});

// Functions to update the state directly
const mutations = {
  setApp(state, app) {
    state.app = app;
  }
};

// Functions to get data from the API
const actions = {
  async getBasicInfo({ commit }) {
    try {
      const app = await API.get(
        `${process.env.VUE_APP_BACKEND_API_URL}/v1/apps${window.location.search}`
      );

      commit("setApp", app);
    } catch (error) {
      //
    }
  }
};

const getters = {};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
};
