import lunr from "lunr";
import API from "@/helpers/api";

// Initial state
const state = () => ({
  appStoreScrollTop: 0, // to preserve app store scroll position when user switches back-and-forth between app listings
  installed: [],
  store: [],
  installing: [],
  uninstalling: [],
  updating: [],
  noAppsInstalled: false, // we store this seperately instead of checking for empty installed array as that's the default state
  searchIndex: null,
  searchQuery: "",
  searchResults: [],
  communityAppStoreApps: [],
});

// Functions to update the state directly
const mutations = {
  setAppStoreScrollTop(state, appStoreScrollTop) {
    state.appStoreScrollTop = appStoreScrollTop;
  },
  setInstalledApps(state, apps) {
    const alphabeticallySortedApps = apps.sort((a, b) => a.name.localeCompare(b.name));
    state.installed = alphabeticallySortedApps;
    state.noAppsInstalled = !apps.length;
  },
  setAppStore(state, appStore) {

    // build a new search index if the app store has changed
    // we store this in global state so it doesn't have to
    // regenerate everytime the app store view is loaded and
    // to persist the search query if the user changes views
    if (state.store.length !== appStore.length) {
      const searchIndex = lunr(function () {
        this.ref('id');

        // bump up the priority of name matching over tagline matching
        // https://github.com/olivernn/lunr.js/issues/312#issuecomment-399657187
        this.field('name', { boost: 10 }); 
        this.field('tagline');

        appStore.forEach((app) => {
          this.add(app)
        }, this);
      });
      state.searchIndex = searchIndex;
    }

    state.store = appStore;
  },
  setSearchQuery(state, searchQuery) {
    state.searchQuery = searchQuery;
  },
  setSearchResults(state, searchResults) {
    state.searchResults = searchResults;
  },
  addInstallingApp(state, appId) {
    if (!state.installing.includes(appId)) {
      state.installing.push(appId);
    }
  },
  removeInstallingApp(state, appId) {
    const index = state.installing.findIndex((id) => id === appId);
    if (index !== -1) {
      state.installing.splice(index, 1);
    }
  },
  addUninstallingApp(state, appId) {
    if (!state.uninstalling.includes(appId)) {
      state.uninstalling.push(appId);
    }
  },
  removeUninstallingApp(state, appId) {
    const index = state.uninstalling.findIndex((id) => id === appId);
    if (index !== -1) {
      state.uninstalling.splice(index, 1);
    }
  },
  addUpdatingApp(state, appId) {
    if (!state.updating.includes(appId)) {
      state.updating.push(appId);
    }
  },
  removeUpdatingApp(state, appId) {
    const index = state.updating.findIndex((id) => id === appId);
    if (index !== -1) {
      state.updating.splice(index, 1);
    }
  },
  setCommunityAppStoreApps(state, apps) {
    state.communityAppStoreApps = apps;
  }
};

// Functions to get data from the API
const actions = {
  updateAppStoreScrollTop({ commit }, scrollTop) {
    commit("setAppStoreScrollTop", scrollTop);
  },
  async getInstalledApps({ commit }) {
    const installedApps = await API.get(`${process.env.VUE_APP_MANAGER_API_URL}/v1/apps?installed=1`);
    if (installedApps) {
      commit("setInstalledApps", installedApps);
    }
  },
  async getAppStore({ commit, dispatch }) {
    dispatch("getInstalledApps");
    const appStore = await API.get(`${process.env.VUE_APP_MANAGER_API_URL}/v1/apps`);
    if (appStore) {
      commit("setAppStore", appStore);
    }
  },
  async getCommunityAppStoreApps({ commit, dispatch }, communityAppStoreId) {
    dispatch("getInstalledApps");
    const apps = await API.get(`${process.env.VUE_APP_MANAGER_API_URL}/v1/apps?repo=${communityAppStoreId}`);
    if (apps) {
      commit("setCommunityAppStoreApps", apps);
    }
  },
  searchAppStore({ state, commit }, searchQuery) {
    commit("setSearchQuery", searchQuery);

    // don't try to search for no query, eg. when
    // the user clears the search input
    if (!searchQuery) {
      return;
    }

    // don't search if the search index isn't built yet
    if (!state.searchIndex) {
      return commit("setSearchResults", []);
    }

    // get search results
    // ~1 = allow fuzzy matching upto 1 character of mistake
    // * = to allow for autocomplete search (eg. showing nextcloud when "nex" is typed)
    // docs: https://lunrjs.com/guides/searching.html
    const searchResults = state.searchIndex.search(`${searchQuery}~1 ${searchQuery}*`);

    // create a new array of matched results
    // in the same sorting order as lunr provides
    const matchedApps = searchResults.map(result => state.store.find(app => app.id === result.ref));

    commit("setSearchResults", matchedApps);
  },
  async update({ state, commit, dispatch }, appId) {
    commit("addUpdatingApp", appId);
    try {
      await API.post(
        `${process.env.VUE_APP_MANAGER_API_URL}/v1/apps/${appId}/update`
      );
    } catch (error) {
      commit("removeUpdatingApp", appId);

      throw error;
    }

    const poll = window.setInterval(async () => {
      await dispatch("getInstalledApps");
      const app = state.installed.find((app) => app.id === appId);
      if (app && !app.update.version) {
        commit("removeUpdatingApp", appId);
        window.clearInterval(poll);
      }
    }, 5000);
  },
  async uninstall({ state, commit, dispatch }, appId) {
    commit("addUninstallingApp", appId);

    try {
      await API.post(
        `${process.env.VUE_APP_MANAGER_API_URL}/v1/apps/${appId}/uninstall`
      );
    } catch(error) {
      commit("removeUninstallingApp", appId);

      throw error;
    }

    const poll = window.setInterval(async () => {
      await dispatch("getInstalledApps");
      const index = state.installed.findIndex((app) => app.id === appId);
      if (index === -1) {
        commit("removeUninstallingApp", appId);
        window.clearInterval(poll);
      }
    }, 5000);
  },
  async install({ state, commit, dispatch }, appId) {
    commit("addInstallingApp", appId);
    try {
      await API.post(
        `${process.env.VUE_APP_MANAGER_API_URL}/v1/apps/${appId}/install`
      );
    } catch (error) {
      commit("removeInstallingApp", appId);

      throw error;
    }

    const poll = window.setInterval(async () => {
      await dispatch("getInstalledApps");
      const index = state.installed.findIndex((app) => app.id === appId);
      if (index !== -1) {
        commit("removeInstallingApp", appId);
        window.clearInterval(poll);
      }
    }, 5000);
  }
};

const getters = {};

export default {
  namespaced: true,
  state,
  actions,
  getters,
  mutations
};
