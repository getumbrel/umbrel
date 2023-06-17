import Vue from "vue";
import { BootstrapVue, BootstrapVueIcons } from "bootstrap-vue";

import App from "./App.vue";
import router from "./router";
import store from "./store";

import { satsToBtc } from "@/helpers/units";

// import "@/global-styles/designsystem.scss";
// import 'bootstrap/dist/css/bootstrap.css'
// import 'bootstrap-vue/dist/bootstrap-vue.css'

Vue.use(BootstrapVue);
Vue.use(BootstrapVueIcons);

//transforms a number to sats or btc based on store
Vue.filter("unit", value => {
  if (store.state.system.unit === "sats") {
    return Number(value);
  } else if (store.state.system.unit === "btc") {
    return satsToBtc(value);
  }
});

//transforms a number to sats
Vue.filter("sats", value => Number(value));

//transforms a number to btc
Vue.filter("btc", value => satsToBtc(value));

//formats the unit
Vue.filter("formatUnit", unit => {
  if (unit === "sats") {
    return "Sats";
  } else if (unit === "btc") {
    return "BTC";
  }
});

//transforms sats to usd
Vue.filter("satsToUSD", value => {
  if (isNaN(parseInt(value))) {
    return value;
  } else {
    return (
      "$" +
      Number(
        (satsToBtc(value) * store.state.bitcoin.price).toFixed(2)
      ).toLocaleString()
    );
  }
});

//Localized number (comma, seperator, spaces, etc)
Vue.filter("localize", n =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: 8 })
);

Vue.config.productionTip = false;

new Vue({
  router,
  store,
  render: h => h(App)
}).$mount("#app");
