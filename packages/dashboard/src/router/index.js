import Vue from "vue";
import VueRouter from "vue-router";

import store from "@/store";

import WrapperLayout from "../layouts/WrapperLayout.vue";
import HomeLayout from "../layouts/HomeLayout.vue";
import ContentLayout from "../layouts/ContentLayout.vue";

import Start from "../views/Start/Start.vue";
import Login from "../views/Login/Login.vue";
import AppStore from "../views/AppStore/AppStore.vue";
import AppStoreApp from "../views/AppStore/AppStoreApp.vue";
import CommunityAppStore from "../views/AppStore/CommunityAppStore.vue";
import CommunityAppStoreApp from "../views/AppStore/CommunityAppStoreApp.vue";
import Settings from "../views/Settings/Settings.vue";


Vue.use(VueRouter);

const routes = [
  {
    path: "/",
    component: WrapperLayout,
    children: [
      {
        path: "/start",
        meta: { requiresAuth: false },
        name: "start",
        component: Start
      },
      {
        path: "/dashboard",
        meta: { requiresAuth: false },
        name: "dashboardObselete",
        redirect: { name: 'home' }
      },
      {
        path: "/login",
        name: "login",
        component: Login,
        meta: {
          requiresAuth: false,
          wallpaperClass: 'wallpaper-blur wallpaper-slight-dim wallpaper-zoom-in'
        }
      },
      {
        path: "",
        component: HomeLayout,
        meta: { requiresAuth: true },
        children: [
          {
            path: "",
            name: "home"
          },
          {
            path: "/app-store",
            component: ContentLayout,
            meta: { scrollTop: true },
            children: [
              {
                path: "",
                name: "app-store",
                component: AppStore,
                meta: {
                  wallpaperClass: 'wallpaper-content-open wallpaper-zoom-in'
                }
              },
              {
                path: ":id",
                name: "app-store-app",
                component: AppStoreApp,
                meta: {
                  wallpaperClass: 'wallpaper-content-open wallpaper-zoom-in'
                }
              }
            ]
          },
          {
            path: "/community-app-store",
            component: ContentLayout,
            meta: { scrollTop: true },
            children: [
              {
                path: ":communityAppStoreId",
                name: "community-app-store",
                component: CommunityAppStore,
                meta: {
                  wallpaperClass: 'wallpaper-content-open wallpaper-zoom-in',
                }
              },
              {
                path: ":communityAppStoreId/:id",
                name: "community-app-store-app",
                component: CommunityAppStoreApp,
                meta: {
                  wallpaperClass: 'wallpaper-content-open wallpaper-zoom-in',
                }
              }
            ]
          },
          {
            path: "/settings",
            component: ContentLayout,
            meta: { scrollTop: true },
            children: [
              {
                path: "",
                name: "settings",
                component: Settings,
                meta: {
                  wallpaperClass: 'wallpaper-content-open wallpaper-zoom-in'
                } 
              }
            ]
          },
        ]
      }
    ]
  }
];

const router = new VueRouter({
  mode: "history",
  base: process.env.BASE_URL,
  routes,
  scrollBehavior: (to, from, savedPosition) => {
    // Exists when Browser's back/forward pressed
    if (savedPosition) {
      return savedPosition
      // For anchors
    } else if (to.hash) {

      // 500ms timeout allows the page to load or else 
      // smooth scrolling would not scroll to the correct position
      setTimeout(() => {
        const element = document.getElementById(to.hash.replace(/#/, ''))
        if (element && element.scrollIntoView) {
          element.scrollIntoView({block: 'end', behavior: 'smooth'})
        }
      }, 500)

      return { selector: to.hash }
      // By changing queries we are still in the same component, so "from.path" === "to.path" (new query changes just "to.fullPath", but not "to.path").
    } else if (from.path === to.path) {
      return {}
    }

    // scroll to top for ContentLayout (position: fixed) components
    if (to.matched.some(record => record.meta.scrollTop)) {
      // wait for 150ms (transition duration) for current route to fade out and prevent jerk motion
      setTimeout(() => {
        document.getElementsByClassName("content-container")[0].scroll(0, 0);
      }, 150);
    }

    // Scroll to top
    return { x: 0, y: 0 };
  }
});

//Authentication Check
const isLoggedIn = () => !!store.state.user.jwt;

router.beforeEach((to, from, next) => {
  if (to.matched.some(record => record.meta.requiresAuth)) {
    // this route requires auth, check if logged in
    // if not, redirect to login page.
    if (!isLoggedIn()) {
      next({
        path: "/login",
        query: to.name === "home" ? "" : { redirect: to.fullPath }
      });
    } else {
      next();
    }
  } else {
    next(); // always call next()!
  }
});

//Close Mobile Menu after route change
router.afterEach(() => {
  if (store.getters.isMobileMenuOpen) {
    store.commit("toggleMobileMenu");
  }
});

export default router;
