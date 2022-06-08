import API from "@/helpers/api";

// Initial state
const state = () => ({
  redirect: null,
  wallpaper: ""
});

// Functions to update the state directly
const mutations = {
  setRedirect(state, redirect) {
    state.redirect = redirect;
  },
  setWallpaper(state, wallpaper) {
    state.wallpaper = wallpaper;
  }
};

// Functions to get data from the API
const actions = {
  async login({ commit }, { password, otpToken }) {
    const {
      data
    } = await API.post(
      `${process.env.VUE_APP_BACKEND_API_URL}/v1/account/login${window.location.search}`,
      { password, otpToken }
    );

    if (data && data.url) {
      commit("setRedirect", data);
    }
  },

  async getWallpaper({ commit }) {
    const defaultWallpaper = "1.jpg";
    let wallpaper;
    try {
      wallpaper = await API.get(
        `${process.env.VUE_APP_BACKEND_API_URL}/v1/account/wallpaper`
      ) || defaultWallpaper;
    } catch (error) {
      wallpaper = defaultWallpaper;
    }
    return commit("setWallpaper", wallpaper);
  },
};

const getters = {};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
};
