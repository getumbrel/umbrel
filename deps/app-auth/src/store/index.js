import Vue from "vue";
import Vuex from "vuex";

//Modules
import user from "./modules/user";
import apps from "./modules/apps";

Vue.use(Vuex);

// Initial State
const state = {};

// Getters
const getters = {};

// Mutations
const mutations = {};

// Actions
const actions = {};

export default new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules: {
    user,
    apps
  }
});
