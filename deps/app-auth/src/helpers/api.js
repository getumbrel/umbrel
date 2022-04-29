import axios from "axios";
import store from "@/store";

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// An object to store the response time of completed API requests
const responseTime = {};

// An object to store pending API requests
const responsePending = {};

// Interceptor to refresh JWT or logout user based on 401 requests
// and to logout user if lnd is locked
axios.interceptors.response.use(
  function (response) {
    // Any status code that lie within the range of 2xx cause this function to trigger
    // Do something with response data
    return response;
  },
  async function (error) {
    // Any status codes that falls outside the range of 2xx cause this function to trigger

    if(error.response.status == 401) {
      await timeout(3 * 1000);
      return Promise.reject(error);
    }

    // Return any error which is not related to auth
    if (!error.response || error.response.status !== 401) {
      await timeout(5000);
      return Promise.reject(error);
    }

    // Return the same 401 back if user is trying to login with incorrect password
    if (
      error.config.url ===
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/login`
    ) {
      await timeout(5000);
      return Promise.reject(error);
    }

    // Logout user if token refresh didn't work
    if (
      error.config.url ===
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/refresh`
    ) {
      await timeout(5000);
      store.dispatch("user/logout");
      return Promise.reject(error);
    }

    // Try request again with new token if error is due to invalid JWT

    if (error.response.data === "Invalid JWT") {
      try {
        await store.dispatch("user/refreshJWT");
      } catch (error) {
        await timeout(5000);
        return Promise.reject(error);
      }

      // New request with new token
      const config = error.config;
      config.headers["Authorization"] = `JWT ${store.state.user.jwt}`;

      return new Promise((resolve, reject) => {
        axios
          .request(config)
          .then(response => {
            resolve(response);
          })
          .catch(error => {
            setTimeout(() => {
              reject(error);
            }, 5000)
          });
      });
    }
  }
);

// Helper methods for making API requests
const API = {
  async get(url, data = {}, auth = true) {
    let response;

    if (responsePending[url] === undefined || responsePending[url] === false) {
      responsePending[url] = true;

      try {
        const startTime = new Date();
        // await new Promise(resolve => setTimeout(resolve, 2000)) //2s API delay

        const requestOptions = {
          method: "get",
          url
        };

        if (auth && store.state.user.jwt) {
          requestOptions.headers = {
            Authorization: `JWT ${store.state.user.jwt}`
          };
        }

        response = (await axios(requestOptions, data)).data;
        const endTime = new Date();

        responseTime[url] = (endTime.getTime() - startTime.getTime()) / 1000;
      } catch (error) {
        // Only display error messages in the browser console
        if (process.browser) {
          console.error(error);
        }

        response = false;
      } finally {
        responsePending[url] = false; // eslint-disable-line require-atomic-updates
      }
    }

    return response;
  },

  // Wrap a post call
  async post(url, data = {}, auth = true) {
    const requestOptions = {
      method: "post",
      url,
      data
    };

    if (auth && store.state.user.jwt) {
      requestOptions.headers = { Authorization: `JWT ${store.state.user.jwt}` };
    }

    return axios(requestOptions);
  },

  // Wrap a delete call
  async delete(url, data, auth = true) {
    const requestOptions = {
      method: "delete",
      url,
      data
    };

    if (auth && store.state.user.jwt) {
      requestOptions.headers = { Authorization: `JWT ${store.state.user.jwt}` };
    }

    return axios(requestOptions);
  },

  // Wrap a download call (GET)
  async download(url, data = {}, auth = true, filename = "download") {
    let response;

    if (responsePending[url] === undefined || responsePending[url] === false) {
      responsePending[url] = true;

      try {
        const startTime = new Date();
        // await new Promise(resolve => setTimeout(resolve, 2000)) //2s API delay

        const requestOptions = {
          method: "get",
          url,
          responseType: "blob"
        };

        if (auth && store.state.user.jwt) {
          requestOptions.headers = {
            Authorization: `JWT ${store.state.user.jwt}`
          };
        }

        response = (await axios(requestOptions, data)).data;

        const endTime = new Date();
        responseTime[url] = (endTime.getTime() - startTime.getTime()) / 1000;

        // Download file
        const blob = new Blob([response]);
        const blobURL = (window.URL && window.URL.createObjectURL) ? window.URL.createObjectURL(blob) : window.webkitURL.createObjectURL(blob);
        const tempLink = document.createElement('a');
        tempLink.style.display = 'none';
        tempLink.href = blobURL;
        tempLink.setAttribute('download', filename);

        // Safari thinks _blank anchor are pop ups. We only want to set _blank
        // target if the browser does not support the HTML5 download attribute.
        // This allows us to download files in desktop safari if pop up blocking
        // is enabled.
        if (typeof tempLink.download === 'undefined') {
          tempLink.setAttribute('target', '_blank');
        }

        document.body.appendChild(tempLink);
        tempLink.click();

        // Fixes "webkit blob resource error 1"
        setTimeout(function () {
          document.body.removeChild(tempLink);
          window.URL.revokeObjectURL(blobURL);
        }, 200)

      } catch (error) {
        // Only display error messages in the browser console
        if (process.browser) {
          console.error(error);
        }

        response = false;
      } finally {
        responsePending[url] = false; // eslint-disable-line require-atomic-updates
      }
    }

    return response;
  },

  // Return the response time if this URL has already been fetched
  responseTime(url) {
    let duration = -1;

    if (responseTime[url] !== undefined) {
      duration = responseTime[url];
    }

    return duration;
  }
};

export default API;
