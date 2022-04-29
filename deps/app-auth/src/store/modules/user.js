import API from "@/helpers/api";
import router from "@/router";

// Initial state
const state = () => ({
  name: "",
  jwt: window.localStorage.getItem("jwt") || "",
  redirect: null,
  registered: true,
  seed: [],
  installedApps: [],
  otpEnabled: false
});

// Functions to update the state directly
const mutations = {
  setJWT(state, jwt) {
    window.localStorage.setItem("jwt", jwt);
    state.jwt = jwt;
  },
  setRedirect(state, redirect) {
    state.redirect = redirect;
  },
  setRegistered(state, registered) {
    state.registered = registered;
  },
  setName(state, name) {
    state.name = name;
  },
  setInstalledApps(state, installedApps) {
    state.installedApps = installedApps;
  },
  setSeed(state, seed) {
    state.seed = seed;
  },
  setOtpEnabled(state, otpEnabled) {
    state.otpEnabled = otpEnabled;
  }
};

// Functions to get data from the API
const actions = {
  async login({ commit }, { password, otpToken }) {
    const {
      data
    } = await API.post(
      `/v1/account/login` + window.location.search,
      { password, otpToken }
    );

    if (data && data.url) {
      commit("setRedirect", data);
    }
  },

  logout({ commit, state }) {
    if (state.jwt) {
      commit("setJWT", "");
      router.push("/");
    }
  },

  async refreshJWT({ commit }) {
    const { data } = await API.post(
      `/v1/account/refresh`
    );
    if (data && data.jwt) {
      commit("setJWT", data.jwt);
    }
  },

  async registered({ commit }) {
    const { registered } = await API.get(
      `/v1/account/registered`
    );
    commit("setRegistered", !!registered);
  },

  async getInfo({ commit }) {
    const { name, otpEnabled, installedApps } = await API.get(
      `/v1/account/info`
    );
    commit("setName", name);
    commit("setOtpEnabled", otpEnabled);
    commit("setInstalledApps", installedApps);
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
