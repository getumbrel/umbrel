import API from "@/helpers/api";
import router from "@/router";

// Initial state
const state = () => ({
  name: "",
  jwt: window.localStorage.getItem("jwt") || "",
  registered: true,
  seed: [],
  communityAppStores: [],
  otpEnabled: false,
  wallpaper: "",
  remoteTorAccess: false
});

// Functions to update the state directly
const mutations = {
  setJWT(state, jwt) {
    window.localStorage.setItem("jwt", jwt);
    state.jwt = jwt;
  },
  setRegistered(state, registered) {
    state.registered = registered;
  },
  setName(state, name) {
    state.name = name;
  },
  setCommunityAppStores(state, communityAppStores) {
    state.communityAppStores = communityAppStores;
  },
  setSeed(state, seed) {
    state.seed = seed;
  },
  setOtpEnabled(state, otpEnabled) {
    state.otpEnabled = otpEnabled;
  },
  setWallpaper(state, wallpaper) {
    state.wallpaper = wallpaper;
  },
  setRemoteTorAccess(state, remoteTorAccess) {
    state.remoteTorAccess = remoteTorAccess;
  }
};

// Functions to get data from the API
const actions = {
  async login({ commit }, { password, otpToken }) {
    const {
      data
    } = await API.post(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/login`,
      { password, otpToken }
    );

    if (data && data.jwt) {
      commit("setJWT", data.jwt);
    }
  },

  async logout({ commit, state }) {
    if (state.jwt) {
      try {
        await API.post(
          `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/logout`
        );
      } catch(e) {
        console.error("Failed to logout server-side", e);
      }

      commit("setJWT", "");
      router.push({name: 'login'});
    }
  },

  // We use this to logout the user on a failed refresh attempt.
  // We don't want to do a full logout because that triggers a new API
  // request which will fail the auth attempt and be retried after a token
  // refresh causing an infinite loop of refresh/logout attempts
  async softLogout({ commit }) {
    commit("setJWT", "");
    router.push({name: 'login'});
  },

  async refreshJWT({ commit }) {
    const { data } = await API.post(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/refresh`
    );
    if (data && data.jwt) {
      commit("setJWT", data.jwt);
    }
  },

  async registered({ commit }) {
    const { registered } = await API.get(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/registered`
    );
    commit("setRegistered", !!registered);
  },

  async getInfo({ commit }) {
    const { name, otpEnabled, remoteTorAccess, communityAppRepos } = await API.get(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/info`
    );
    commit("setName", name);
    commit("setOtpEnabled", otpEnabled);
    commit("setRemoteTorAccess", remoteTorAccess);
    commit("setCommunityAppStores", communityAppRepos);
  },

  async getSeed({ commit, state, dispatch }, { password, otpToken }) {
    let rawSeed;

    //first check if user is registered or not
    await dispatch("registered");

    //get user's stored seed if already registered
    if (state.registered && password) {
      rawSeed = await API.post(
        `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/seed`,
        {
          password,
          otpToken
        },
        false
      );
      if (rawSeed.data) {
        rawSeed = rawSeed.data;
      }
    } else {
      //get a new seed if new user
      rawSeed = await API.get(
        `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/wallet/seed`
      );
    }

    if (rawSeed && rawSeed.seed) {
      commit("setSeed", rawSeed.seed);
    }
  },

  async register({ commit, state }, { name, password }) {
    if (!state.registered) {
      const result = await API.post(
        `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/register`,
        {
          name,
          password
        },
        false
      );

      if (result.data && result.data.jwt) {
        commit("setJWT", result.data.jwt);
        commit("setRegistered", true);
      }
    }
  },
  async enableOtpAuth({ commit }, { otpToken, otpUri }) {
    await API.post(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/otp/enable`,
      {
        otpToken,
        otpUri
      },
      false
    );
    return commit("setOtpEnabled", true);
  },
  async disableOtpAuth({ commit }, { otpToken }) {
    await API.post(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/otp/disable`,
      {
        otpToken
      },
      false
    );
    return commit("setOtpEnabled", false);
  },
  async getWallpaper({ commit }) {
    const defaultWallpaper = "1.jpg";
    let wallpaper;
    try {
      wallpaper = await API.get(`${process.env.VUE_APP_MANAGER_API_URL}/v1/account/wallpaper`) || defaultWallpaper;
    } catch (error) {
      wallpaper = defaultWallpaper;
    }
    return commit("setWallpaper", wallpaper);
  },
  async setWallpaper({ commit }, wallpaper) {
    // Update state immediately to make the new wallpaper live
    commit("setWallpaper", wallpaper);
    await API.post(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/wallpaper`,
      {wallpaper},
    );
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
