<template>
  <div class="">
    <div class="my-3">
      <div class="d-flex justify-content-between align-items-center">
        <h1 class="text-title mb-0">settings</h1>
      </div>
    </div>
    <b-row>
      <b-col cols="12" md="6" lg="4" >
      <storage-widget id="storage" class="card-app-list"></storage-widget>

      <ram-widget id="ram" class="card-app-list"></ram-widget>
      </b-col>

      <b-col cols="12" md="6" lg="4">
      <temperature-widget id="temperature" class="card-app-list" v-if="isUmbrelOS"></temperature-widget>

      <card-widget
        header="Account"
        class="card-app-list"
        :loading="isChangingName || isChangingPassword || isFetchingOtpUri"
      >
        <div class="pt-2">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Two-factor auth (2FA)</span>
              <small class="d-block" style="opacity: 0.4">An extra layer of security to login</small>
            </div>
            <toggle-switch
              class="align-self-center"
              @turnOn="toggleOtpAuthSwitch"
              @turnOff="toggleOtpAuthSwitch"
              :on="otpEnabled"
              :loading="isFetchingOtpUri"
            ></toggle-switch>

            <b-modal id="enable-otp-auth-modal" centered hide-footer ref="enable-otp-auth-modal">
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <h3>Enable 2FA</h3>
                  
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
                    <img :src="require(`@/assets/icon-modal-close.svg`)" />
                  </a>
                </div>
              </template>
              <div class="px-1 px-sm-4 pb-3 text-center">
                <div class="mb-4">
                  <p>Scan this QR code using an authenticator app like Google Authenticator or Authy</p>
                  <div class="otp-qr-container bg-white d-flex justify-content-center align-items-center mx-auto mb-3 br-sm">
                    <qr-code
                      class="mx-auto"
                      :value="otpUri"
                      :size="200"
                      level="Q"
                      showLogo
                    ></qr-code>
                  </div>
                  <p>Or paste the following code in the app</p>
                  <input-copy class="w-100 mx-auto" size="sm" :value="otpSecretKey"></input-copy>
                </div>

                <label> 
                  Enter the code displayed in your authenticator app to enable 2FA
                </label>
                <input-otp-token
                  autofocus
                  :success="isCorrectOtp"
                  :error="isIncorrectOtp"
                  :disabled="isTogglingOtpAuth"
                  @otpToken="enableOtpAuth"
                />
              </div> 
            </b-modal>

              <b-modal id="disable-otp-auth-modal" centered hide-footer ref="disable-otp-auth-modal">
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <h3>Disable 2FA</h3>
                  
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
                    <img :src="require(`@/assets/icon-modal-close.svg`)" />
                  </a>
                </div>
              </template>
              <div class="px-1 px-sm-4 pb-3">
                <label> 
                  Enter the code displayed in your authenticator app to disable 2FA
                </label>
                <input-otp-token
                  autofocus
                  :success="isCorrectOtp"
                  :error="isIncorrectOtp"
                  :disabled="isTogglingOtpAuth"
                  @otpToken="disableOtpAuth"
                />
              </div> 
            </b-modal>

            </div>
        </div>
        <div class="pt-0">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Name</span>
              <small class="d-block" style="opacity: 0.4">Change your display name</small>
            </div>

            <b-button
              variant="outline-primary"
              size="sm"
              v-b-modal.change-name-modal
              :disabled="isChangingName"
            >Change</b-button>

            <b-modal id="change-name-modal" ref="change-name-modal" centered hide-footer>
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <h3>change name</h3>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
                    <img :src="require(`@/assets/icon-modal-close.svg`)" />
                  </a>
                </div>
              </template>
              <div class="px-4 pb-2">
                <label class="sr-onlsy" for="input-withdrawal-amount">New name</label>
                <b-form-input
                  v-model.trim="newName"
                  ref="name"
                  :placeholder="name"
                  autofocus
                  class="form-control form-control-lg neu-input w-100"
                  :disabled="isChangingName"
                />
                <div class="py-2"></div>
                <b-button
                  class="w-100"
                  variant="success"
                  size="lg"
                  :disabled="isChangingName || newName.length === 0"
                  @click="changeName"
                >{{ isChangingName ? 'Changing name...' : 'Change name'}}</b-button>
              </div>
            </b-modal>
          </div>
        </div>
        <div class="pt-0">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Password</span>
              <small class="d-block" style="opacity: 0.4">Change your Umbrel's password</small>
            </div>

            <b-button
              variant="outline-primary"
              size="sm"
              v-b-modal.change-password-modal
              :disabled="isChangingPassword"
            >Change</b-button>

            <b-modal id="change-password-modal" ref="change-password-modal" centered hide-footer>
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <h3>change password</h3>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="align-self-center" v-on:click.stop.prevent="close">
                    <img :src="require(`@/assets/icon-modal-close.svg`)" />
                  </a>
                </div>
              </template>
              <div class="px-4 pb-2">
                <label class="sr-onlsy" for="input-withdrawal-amount">Current password</label>
                <input-password
                  v-model="currentPassword"
                  ref="password"
                  inputGroupClass="neu-input-group"
                  :inputClass="[ isIncorrectPassword ? 'incorrect-password' : '', 'form-control form-control-lg neu-input w-100']"
                  :disabled="isChangingPassword"
                />
                <div class="py-2"></div>
                <label class="sr-onlsy" for="input-withdrawal-amount">New password</label>
                <input-password
                  v-model="newPassword"
                  ref="password"
                  inputGroupClass="neu-input-group"
                  inputClass="form-control form-control-lg neu-input w-100"
                  :disabled="isChangingPassword"
                />
                <div class="py-2"></div>
                <label class="sr-onlsy" for="input-withdrawal-amount">Confirm new password</label>
                <input-password
                  v-model="confirmNewPassword"
                  ref="password"
                  inputGroupClass="neu-input-group"
                  inputClass="form-control form-control-lg neu-input w-100"
                  :disabled="isChangingPassword"
                />
                <div v-if="otpEnabled" class="py-2">
                  <label> 
                    Enter your two-factor authentication (2FA) code
                  </label>
                  <input-otp-token
                    :success="isCorrectOtp"
                    :error="isIncorrectOtp"
                    :disabled="isTogglingOtpAuth"
                    @otpToken="setOtpToken"
                  />
                </div>
                <div class="py-2"></div>
                <b-alert variant="warning" show>
                  <small>
                    ⚠ Remember, there is no "Forgot Password" button. If you lose
                    your password, you will not be able to login to your Umbrel.
                  </small>
                </b-alert>
                <b-button
                  class="w-100"
                  variant="success"
                  size="lg"
                  :disabled="isChangingPassword || !isAllowedToChangePassword"
                  @click="changePassword"
                >{{ isChangingPassword ? 'Changing password...' : 'Change password'}}</b-button>
              </div>
            </b-modal>
          </div>
        </div>
        <div class="px-3 px-xl-4 mb-4">
          <div class="d-flex justify-content-between w-100 mb-3">
            <div class="w-75">
              <span class="d-block">Remote Tor access</span>
              <small
                class="d-block"
                style="opacity: 0.4"
              >Remotely access your Umbrel from anywhere using a Tor browser {{remoteTorAccess && onionAddress ? 'on this URL' : ''}}</small>
            </div>
            <toggle-switch
              class="align-self-center"
              @turnOn="toggleRemoteTorAccessSwitch"
              @turnOff="toggleRemoteTorAccessSwitch"
              :on="remoteTorAccessIsOn"
              :loading="remoteTorAccessInFlight"
            ></toggle-switch>
          </div>
          <input-copy v-if="remoteTorAccess && onionAddress" class="w-100" size="sm" :value="onionAddress"></input-copy>
        </div>
        <div class="px-3 px-xl-4 py-1"></div>
      </card-widget>

      </b-col>

      <b-col cols="12" md="6" lg="4">

      <card-widget
        header="System"
        class="card-app-list"
        :loading="isCheckingForUpdate || isUpdating"
      >
        <div class="d-block pt-2"></div>
        <!-- Uptime monitoring is only available on Umbrel OS -->
        <div class="pt-0" v-if="isUmbrelOS">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Uptime</span>
              <small class="d-block" style="opacity: 0.4">Time since last restart</small>
            </div>
            <div class="text-right">
              <span class="d-block">{{ getUptime }}</span>
            </div>
          </div>
        </div>
        <div class="pt-0">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Shutdown</span>
              <small class="d-block" style="opacity: 0.4">Power off your Umbrel</small>
            </div>
            <b-button variant="outline-primary" size="sm" @click="shutdownPrompt">Shutdown</b-button>
          </div>
        </div>
        <div class="pt-0">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Restart</span>
              <small class="d-block" style="opacity: 0.4">Restart your Umbrel</small>
            </div>

            <b-button variant="outline-primary" size="sm" @click="rebootPrompt">Restart</b-button>
          </div>
        </div>
        <div class="pt-0">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Troubleshoot</span>
              <small class="d-block" style="opacity: 0.4">View logs for troubleshooting</small>
            </div>
            <b-button variant="outline-primary" size="sm" @click="openDebugModal">Start</b-button>
            <b-modal
              ref="debug-modal"
              size="xl"
              scrollable
              header-bg-variant="dark"
              header-text-variant="light"
              footer-bg-variant="dark"
              footer-text-variant="light"
              body-bg-variant="dark"
              body-text-variant="light"
              @close="closeDebugModal"
            >
            <template v-slot:modal-header="{ close }">
              <div
                class="px-2 pt-2 d-flex justify-content-between w-100"
              >
                <h4 v-if="loadingDebug">Generating logs...</h4> 
                <h4 v-else>{{ showDmesg ? 'DMESG logs' : 'Umbrel logs' }}</h4>
                <!-- Emulate built in modal header close button action -->
                <a
                  href="#"
                  class="align-self-center"
                  v-on:click.stop.prevent="close"
                >
                  <img :src="require(`@/assets/icon-modal-close.svg`)" />
                </a>
              </div>
            </template>
              <div v-if="debugFailed" class="d-flex justify-content-center">
                Error: Failed to fetch debug data.
              </div>
              <div v-else-if="loadingDebug" class="d-flex justify-content-center">
                <b-spinner></b-spinner>
              </div>
              <pre class="px-2 text-light">{{debugContents}}</pre>

              <template #modal-footer="{}">
                <div v-if="loadingDebug"></div>
                <div class="d-flex w-100 justify-content-between px-2" v-else>
                  <b-button size="sm" variant="outline-success" @click="showDmesg=!showDmesg">
                    <b-icon icon="arrow-left-right" class="mr-1"></b-icon> View {{ (!showDmesg) ? "DMESG logs" : "Umbrel logs" }}
                  </b-button>
                  <b-button size="sm" variant="outline-success" @click="downloadTextFile(debugContents, debugFilename)">
                    <b-icon icon="download" class="mr-2"></b-icon>Download {{ showDmesg ? "DMESG logs" : "Umbrel logs" }}
                  </b-button>
                </div>
              </template>
            </b-modal>
          </div>
        </div>
        <!-- migration assistant is only for Umbrel Home -->
        <div class="pt-0" v-if="isUmbrelHome">
          <div class="d-flex w-100 justify-content-between px-3 px-xl-4 mb-4">
            <div>
              <span class="d-block">Migration Assistant</span>
              <small class="d-block" style="opacity: 0.4">Transfer data from your Raspberry Pi to your Umbrel Home</small>
            </div>
            <b-button variant="outline-primary" size="sm" @click="openMigrationModal">Migrate</b-button>

            <!-- INTRO STEP -->
            <b-modal v-if="migrationState.migrationStep === 'intro'" id="migration-modal" ref="migration-modal" size="lg" centered hide-footer>
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <div>
                    <h3 class="mb-1">Migration Assistant</h3>
                    <p class="text-muted mb-0">Transfer all your apps and data from a Raspberry Pi-based umbrelOS server to your Umbrel Home in 3 steps</p>
                  </div>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="" @click.stop.prevent="close">
                    <img :src="require(`@/assets/icon-modal-close.svg`)" />
                  </a>
                </div>
              </template>
              <div class="px-3 pb-3">
                <div class="py-2">
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-sm">
                      <img :src="require(`@/assets/migration-assistant/icon-power-btn.svg`)" />
                    </div>
                    <p class="mb-0 ml-2">Poweroff your Raspberry Pi-based Umbrel</p>
                  </div>
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-sm">
                      <img :src="require(`@/assets/migration-assistant/icon-usb.svg`)" />
                    </div>
                    <p class="mb-0 ml-2">Connect its SSD to your Umbrel Home via USB</p>
                  </div>
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-sm">
                      <img :src="require(`@/assets/migration-assistant/icon-right-arrow.svg`)" />
                    </div>
                    <p class="mb-0 ml-2">Once done, click 'Continue' below</p>
                  </div>
                </div>
                <!-- <div class="d-flex align-items-center pt-2"> -->
                <div class="migration-modal-footer">
                  <b-button
                  class="migration-button"
                  :class="{ 'fade-in-out': migrationState.isCheckingMigration }"
                  variant="success"
                  size=""
                  @click="nextMigrationStep"
                  >Continue</b-button>
                  <b-alert class="mb-0 py-1 px-2 w-100" variant="danger" show>
                    <div class="d-flex align-items-center">
                      <p class="mb-0">
                        <img :src="require(`@/assets/migration-assistant/icon-warning.svg`)" />
                        The data on your Umbrel Home, if any, will be permanently deleted</p>
                    </div>
                  </b-alert>
                </div>
              </div>
            </b-modal>

            <!-- START MIGRATION STEP -->
            <b-modal v-if="migrationState.migrationStep === 'migrate'" id="migration-modal" ref="migration-modal" size="lg" centered hide-footer>
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <div>
                    <h3 class="mb-1">You're all set to migrate!</h3>
                    <p class="text-muted mb-0">Your apps and data are ready to be transferred to your Umbrel Home</p>
                  </div>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="" @click.stop.prevent="close">
                    <img :src="require(`@/assets/icon-modal-close.svg`)" />
                  </a>
                </div>
              </template>
              <div class="px-3 pb-3">
                <div class="py-2">
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-lg">
                      <img :src="require(`@/assets/migration-assistant/icon-password.svg`)" />
                    </div>
                    <div class="ml-2">
                      <p class="mb-0">Use your previous password</p>
                      <p class="text-muted mb-0">Remember to use the password from your Raspberry Pi-based Umbrel to unlock your Umbrel Home</p>
                    </div>
                  </div>
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-lg">
                      <img :src="require(`@/assets/migration-assistant/icon-power-btn-red.svg`)" />
                    </div>
                    <div class="ml-2">
                      <p class="mb-0">Keep your Raspberry Pi-based Umbrel turned off after the migration</p>
                      <p class="text-muted mb-0">This helps prevent issues with certain apps, such as Lightning Node. After migration you can wipe your old drive.</p>
                    </div>
                  </div>
                </div>
                <div class="migration-modal-footer">
                  <b-button
                  class="migration-button"
                  :class="{ 'fade-in-out': migrationState.isMigrating }"
                  variant="success"
                  size=""
                  :disabled="migrationState.isMigrating"
                  @click="nextMigrationStep"
                  >Migrate</b-button>
                  <b-alert class="mb-0 py-1 px-2 w-100" variant="danger" show>
                    <div class="d-flex align-items-center">
                      <p class="mb-0">
                        <img :src="require(`@/assets/migration-assistant/icon-warning.svg`)" />
                        The data on your Umbrel Home, if any, will be permanently deleted.</p>
                    </div>
                  </b-alert>
                </div>
              </div>
            </b-modal>

            <!-- ERROR STEP -->
            <b-modal v-if="migrationState.migrationStep === 'try-again'" id="migration-modal" ref="migration-modal" size="lg" centered hide-footer>
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <div>
                    <h3 class="mb-1">Oops, something's not right!</h3>
                    <p class="text-muted mb-0">Fix the following errors and try again</p>
                  </div>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="" @click.stop.prevent="close">
                    <img :src="require(`@/assets/icon-modal-close.svg`)" />
                  </a>
                </div>
              </template>
              <div class="px-3 pb-2">
                <div class="py-2">
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-lg">
                      <img :src="require(`@/assets/migration-assistant/icon-error-warning.svg`)" />
                    </div>
                    <div class="ml-2">
                      <p class="mb-0">{{ migrationState.migrationError.title }}</p>
                      <p class="text-muted mb-0">{{ migrationState.migrationError.description }}</p>
                    </div>
                  </div>
                </div>
                <div class="migration-modal-footer">
                  <b-button
                  class="migration-button"
                  variant="success"
                  size=""
                  :disabled="migrationState.isMigrating"
                  @click="nextMigrationStep"
                  >Try Again</b-button>
                </div>
              </div>
            </b-modal>
          </div>
        </div>
        <div class="px-3 px-xl-4 pb-4">
          <div class="w-100 d-flex justify-content-between mb-1">
            <span class="align-self-end">umbrelOS Version</span>
            <span class="font-weight-normal mb-0">{{ version }}</span>
          </div>
          <div v-show="!isCheckingForUpdate">
            <span v-show="!availableUpdate.version">
              <b-icon icon="check-circle-fill" variant="success"></b-icon>
              <small class="ml-1" style="opacity: 0.4">You are on the latest version</small>
            </span>
            <div v-show="availableUpdate.version">
              <span class="d-block">
                <b-icon icon="bell-fill" variant="success"></b-icon>
                <small
                  class="text-muted ml-1"
                >umbrelOS {{availableUpdate.version}} is now available to install</small>
              </span>
              <b-button
                class="mt-2"
                variant="primary"
                size="sm"
                @click.prevent="confirmUpdate"
                :disabled="isUpdating"
              >Install</b-button>
            </div>
          </div>
        </div>
        <b-button
          class="w-100"
          variant="success"
          style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
          :disabled="isCheckingForUpdate || isUpdating"
          @click="checkForUpdate"
        >
          <b-icon icon="arrow-repeat" class="mr-2" :animation="isCheckingForUpdate ? 'spin' : ''"></b-icon>
          {{ isCheckingForUpdate ? "Checking for update" : "Check for update"}}
        </b-button>
      </card-widget>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import moment from "moment";
import { mapState } from "vuex";

import API from "@/helpers/api";
import delay from "@/helpers/delay";

import CardWidget from "@/components/CardWidget";
import ToggleSwitch from "@/components/ToggleSwitch";
import QrCode from "@/components/Utility/QrCode";
import InputPassword from "@/components/Utility/InputPassword";
import InputCopy from "@/components/Utility/InputCopy";
import InputOtpToken from "@/components/Utility/InputOtpToken";

import StorageWidget from "@/views/Settings/StorageWidget";
import RamWidget from "@/views/Settings/RamWidget";
import TemperatureWidget from "@/views/Settings/TemperatureWidget";

export default {
  data() {
    return {
      currentPassword: "",
      isIncorrectPassword: false,
      newName: "",
      newPassword: "",
      confirmNewPassword: "",
      otpToken: "", // set by OTP input field in change password modal
      isChangingName: false,
      isChangingPassword: false,
      isCheckingForUpdate: false,
      isUpdating: false,
      migrationState: {
        migrationStep: "intro",
        migrationCheckFailed: false,
        isCheckingMigration: false,
        isMigrating: false,
        migrationError: {
          title: "",
          description: ""
        }
      },
      loadingDebug: false,
      debugFailed: false,
      showDmesg: false,
      otpUri: "",
      isCorrectOtp: false,
      isIncorrectOtp: false,
      isFetchingOtpUri: false,
      isTogglingOtpAuth: false,
      remoteTorAccessOnState: false,
    };
  },
  computed: {
    ...mapState({
      version: state => state.system.version,
      name: state => state.user.name,
      onionAddress: state => state.system.onionAddress,
      availableUpdate: state => state.system.availableUpdate,
      updateStatus: state => state.system.updateStatus,
      migrateStatus: (state) => state.system.migrateStatus,
      debugResult: state => state.system.debugResult,
      isUmbrelOS: state => state.system.isUmbrelOS,
      isUmbrelHome: state => state.system.isUmbrelHome,
      uptime: state => state.system.uptime,
      otpEnabled: state => state.user.otpEnabled,
      remoteTorAccess: state => state.user.remoteTorAccess,
      remoteTorAccessStatus: state => state.system.remoteTorAccessStatus,
      remoteTorAccessInFlight: state => state.system.remoteTorAccessInFlight
    }),
    otpSecretKey() {
      if (!this.otpUri) {
        return "";
      }
      const parsedUri = new URL(this.otpUri);
      const secret = parsedUri.searchParams.get('secret');
      return secret;
    },
    getUptime() {
      return moment.duration(this.uptime, "seconds").humanize();
    },
    debugContents() {
      return this.showDmesg ? this.debugResult.dmesg : this.debugResult.debug;
    },
    debugFilename() {
      const type = this.showDmesg ? 'dmesg' : 'debug';
      return `umbrel-${Date.now()}-${type}.log`;
    },
    isAllowedToChangePassword() {
      if (!this.currentPassword) {
        return false;
      }
      if (this.newPassword.length < 12) {
        return false;
      }
      if (this.newPassword !== this.confirmNewPassword) {
        return false;
      }
      if (this.currentPassword === this.newPassword) {
        return false;
      }
      return true;
    },
    remoteTorAccessIsOn() {
      if(this.remoteTorAccessInFlight) {
        return ! this.remoteTorAccess;
      } else {
        return this.remoteTorAccess;
      }
    }
  },
  async created() {
    if(this.remoteTorAccess) {
      this.$store.dispatch("system/getOnionAddress");
    }
    
    this.$store.dispatch("system/getVersion");
    this.$store.dispatch("system/getUptime");
    await this.$store.dispatch("system/getRemoteTorAccessStatus");

    if(this.remoteTorAccessInFlight)
    {
      this.$store.dispatch("system/pollRemoteTorAccessStatus");
    }
  },
  methods: {
    setOtpToken(otpToken) {
      this.otpToken = otpToken;
    },
    async toggleOtpAuthSwitch() {

      // show disable OTP modal
      if (this.otpEnabled) {
        return this.$bvModal.show('disable-otp-auth-modal');
      }

      // show enable OTP modal
      try {
        this.isFetchingOtpUri = true;
        const otpUri = await API.get(`${process.env.VUE_APP_MANAGER_API_URL}/v1/account/otpUri`);
        this.otpUri = otpUri;
        this.isFetchingOtpUri = false;
        this.$bvModal.show('enable-otp-auth-modal');
      } catch (error) {
        if (error.response && error.response.data) {
          this.$bvToast.toast(error.response.data, {
            title: "Error",
            autoHideDelay: 3000,
            variant: "danger",
            solid: true,
            toaster: "b-toaster-bottom-right"
          });
        }
      }
    },
    async enableOtpAuth(otpToken) {
      this.isTogglingOtpAuth = true;
      try {
        await this.$store.dispatch("user/enableOtpAuth", { otpToken, otpUri: this.otpUri });
        this.isCorrectOtp = true;

        // add delay before closing modal
        // to complete ripple animation
        await delay(1000);

        this.$bvToast.toast("You've successfully enabled two-factor authentication", {
          title: "2FA Enabled",
          autoHideDelay: 3000,
          variant: "success",
          solid: true,
          toaster: "b-toaster-bottom-right"
        });
        this.$bvModal.hide('enable-otp-auth-modal');
      } catch (error) {
        if (error.response && error.response.data) {
          let errorText = error.response.data;
          if (error.response.data === "Invalid OTP Token") {
            this.isIncorrectOtp = true;
            errorText = "Incorrect code. Please try again."
          }
          this.$bvToast.toast(errorText, {
            title: "Error",
            autoHideDelay: 3000,
            variant: "danger",
            solid: true,
            toaster: "b-toaster-bottom-right"
          });
        }
      }
      this.isTogglingOtpAuth = false;

      // reset state variables for ripple animation
      await delay(1000);
      this.isIncorrectOtp = false;
      this.isCorrectOtp = false;
    },
    async disableOtpAuth(otpToken) {
      this.isTogglingOtpAuth = true;
      try {
        await this.$store.dispatch("user/disableOtpAuth", { otpToken });
        this.isCorrectOtp = true;

        // add delay before closing modal
        // to complete ripple animation
        await delay(1000);
        this.$bvToast.toast("You've successfully disabled two-factor authentication", {
          title: "2FA Disabled",
          autoHideDelay: 3000,
          variant: "success",
          solid: true,
          toaster: "b-toaster-bottom-right"
        });
        this.$bvModal.hide('disable-otp-auth-modal');
      } catch (error) {
        if (error.response && error.response.data) {
          let errorText = error.response.data;
          if (error.response.data === "Invalid OTP Token") {
            this.isIncorrectOtp = true;
            errorText = "Incorrect code. Please try again."
          }
          this.$bvToast.toast(errorText, {
            title: "Error",
            autoHideDelay: 3000,
            variant: "danger",
            solid: true,
            toaster: "b-toaster-bottom-right"
          });
        }
      }
      this.isTogglingOtpAuth = false;

      // reset state variables for ripple animation
      await delay(1000);
      this.isIncorrectOtp = false;
      this.isCorrectOtp = false;
    },
    async changeName() {
      const payload = {
        newName: this.newName
      };

      this.isChangingName = true;

      try {
        await API.post(
          `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/name`,
          payload
        );
      } catch (error) {
        if (error.response && error.response.data) {
          this.$bvToast.toast(error.response.data, {
            title: "Error",
            autoHideDelay: 3000,
            noAutoHide: true,
            variant: "danger",
            solid: true,
            toaster: "b-toaster-bottom-right"
          });
        }
        this.isChangingName = false;
        return;
      }

      this.$store.dispatch("user/getInfo");
      
      this.$bvToast.toast(
        `Well, hello there ${this.newName}.`,
        {
          title: "Name Changed",
          autoHideDelay: 3000,
          variant: "success",
          solid: true,
          toaster: "b-toaster-bottom-right"
        }
      );

      this.isChangingName = false;
      this.newName = "";

      this.$bvModal.hide("change-name-modal");
    },
    async changePassword() {
      // disable on testnet
      if (window.location.hostname === "testnet.getumbrel.com") {
        return this.$bvToast.toast('y u try to do dis on testnet :"(', {
          title: "Error",
          autoHideDelay: 3000,
          variant: "danger",
          solid: true,
          toaster: "b-toaster-bottom-right"
        });
      }

      const payload = {
        password: this.currentPassword,
        newPassword: this.newPassword,
        otpToken: this.otpToken
      };

      this.isChangingPassword = true;

      try {
        await API.post(
          `${process.env.VUE_APP_MANAGER_API_URL}/v1/account/change-password`,
          payload,
          false
        );
        if (this.otpEnabled) {
          this.isCorrectOtp = true;
          // delay for ripple animation to complete
          await delay(1000);
          this.isCorrectOtp = false;
        }
      } catch (error) {
        if (error.response && error.response.data) {
          let errorText = error.response.data;

          if (error.response.data === "Incorrect password") {
            this.isIncorrectPassword = true;
          }
          if (error.response.data === "Invalid OTP Token") {
            errorText = "Incorrect 2FA code";
            this.isIncorrectOtp = true;

            // delay for ripple animation to complete
            await delay(1000);
            this.isIncorrectOtp = false;
          }

          this.$bvToast.toast(errorText, {
            title: "Error",
            autoHideDelay: 3000,
            noAutoHide: true,
            variant: "danger",
            solid: true,
            toaster: "b-toaster-bottom-right"
          });
        }
        this.isChangingPassword = false;
        return;
      }

      this.$bvToast.toast(
        `You've successfully changed your Umbrel's password`,
        {
          title: "Password Changed",
          autoHideDelay: 3000,
          variant: "success",
          solid: true,
          toaster: "b-toaster-bottom-right"
        }
      );

      this.isChangingPassword = false;

      // Remove passwords from view
      this.currentPassword = "";
      this.newPassword = "";
      this.confirmNewPassword = "";

      this.$bvModal.hide('change-password-modal');
    },
    confirmUpdate() {
      this.$store.dispatch("system/confirmUpdate");
    },
    async checkForUpdate() {
      this.isCheckingForUpdate = true;
      await this.$store.dispatch("system/getAvailableUpdate");
      this.isCheckingForUpdate = false;
    },
    async openDebugModal() {
      this.showDmesg = false;
      this.debugFailed = false;
      this.loadingDebug = true;
      this.$refs["debug-modal"].show();
      try {
        await this.$store.dispatch("system/debug");
        while(this.loadingDebug) {
          await delay(1000);
          await this.$store.dispatch("system/getDebugResult");
          if (this.debugResult.status == "success") {
            this.loadingDebug = false;
          }
        }
      } catch (e) {
          this.debugFailed = true;
      }
    },
    closeDebugModal() {
      this.loadingDebug = false;
      this.$refs["debug-modal"].hide();
    },
    downloadTextFile(contents, fileName) {
      const blob = new Blob([contents], {
        type: 'text/plain;charset=utf-8;'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    },
    openMigrationModal() {
      // rename to modalStep
      this.migrationState.migrationStep = "intro";
      this.$refs["migration-modal"].show();
    },
    async nextMigrationStep() {
      switch (this.migrationState.migrationStep) {
        case "intro":
          await this.canMigrate();
          break;
        case "migrate": // falls through
        case "try-again":
          // if try again was reached because of an error from intro, go back to migrate
          if (this.migrationCheckFailed) {
            await this.canMigrate();
            break;
          }
          await this.startMigration();
          break;
      }
    },
    resetMigrationError() {
      this.migrationState.migrationError = {title: "", description: ""};
    },
    async canMigrate() {
      this.migrationState.isCheckingMigration = true;
      this.resetMigrationError();
      this.migrationCheckFailed = false;

      try {
        const auth = true;
        const throwErrors = true;
        const response = await API.get(`${API.umbreldUrl}/can-migrate`, {}, auth, throwErrors);
        if (response.success) {
          this.migrationState.migrationStep = "migrate";
        } else {
          this.migrationState.migrationError = {title: "Unable to begin migration", description: "Something went wrong. Please try again later."};
          this.migrationCheckFailed = true;
          this.migrationState.migrationStep = "try-again";
        }
      } catch (error) {
        const errorMessage = error.response && error.response.data.error ? error.response.data.error : "Something went wrong. Please try again later.";
        this.migrationState.migrationError = {title: "Unable to begin migration", description: errorMessage};
        this.migrationCheckFailed = true;
        this.migrationState.migrationStep = "try-again";
      } finally {
        this.migrationState.isCheckingMigration = false;
      }
    },
    async startMigration() {
      // TODO: should we handle non-catch errors here?
      this.migrationState.isMigrating = true;
      this.resetMigrationError();

      try {
        await API.post(`${API.umbreldUrl}/migrate`);

        // poll migrate status every second until migration is running (checking regularly to transition quickly)
        // because after it's running, the loading view will take over
        this.pollMigrateStatus = window.setInterval(async () => {
          await this.$store.dispatch("system/getMigrateStatus");
          if (this.migrateStatus.running === true) {
            window.clearInterval(this.pollMigrateStatus);
            this.$store.commit("system/setShowMigrationProgress", true);
          }
        }, 1 * 1000);
      } catch (error) {
        const errorMessage = error.response && error.response.data.error ? error.response.data.error : "Something went wrong. Please try again later.";
        this.migrationState.migrationError = {title: "Unable to begin migration", description: errorMessage}
        this.migrationState.migrationStep = "try-again";
      } finally {
        // delay so flash animation and disabled status hold until migration progress view takes over
        await delay(2000);
        this.migrationState.isMigrating = false;
      }
    },
    async startUpdate() {
      try {
        await API.post(
          `${process.env.VUE_APP_MANAGER_API_URL}/v1/system/update`,
          {}
        );
        this.isUpdating = true;
        // poll update status every 2s until the update process begins
        // because after it's updated, the loading view will take over
        this.pollUpdateStatus = window.setInterval(async () => {
          await this.$store.dispatch("system/getUpdateStatus");
          if (this.updateStatus.state === "installing") {
            window.clearInterval(this.pollUpdateStatus);
          }
        }, 2 * 1000);
      } catch (error) {
        this.$bvToast.toast(`Unable to start the update process`, {
          title: "Error",
          autoHideDelay: 3000,
          variant: "danger",
          solid: true,
          toaster: "b-toaster-bottom-right",
        });
      }
    },
    async shutdownPrompt() {
      // disable on testnet
      if (window.location.hostname === "testnet.getumbrel.com") {
        return this.$bvToast.toast('y u try to do dis on testnet :"(', {
          title: "Error",
          autoHideDelay: 3000,
          variant: "danger",
          solid: true,
          toaster: "b-toaster-bottom-right"
        });
      }

      // Get user consent first
      const approved = window.confirm("Are you sure you want to shutdown your Umbrel?");
      if (!approved) {
        return;
      }

      // Shutdown request
      let toastText = "";
      let toastOptions = {
        autoHideDelay: 3000,
        solid: true,
        toaster: "b-toaster-bottom-right"
      };
      try {
        await this.$store.dispatch("system/shutdown");
      } catch (e) {
        toastText = "Shutdown failed";
        toastOptions.title =
          "Something went wrong and Umbrel was not able to shutdown";
        toastOptions.variant = "danger";
      }
      this.$bvToast.toast(toastText, toastOptions);
    },
    async rebootPrompt() {
      // disable on testnet
      if (window.location.hostname === "testnet.getumbrel.com") {
        return this.$bvToast.toast('y u try to do dis on testnet :"(', {
          title: "Error",
          autoHideDelay: 3000,
          variant: "danger",
          solid: true,
          toaster: "b-toaster-bottom-right"
        });
      }
      // Reset any cached hasRebooted value from previous reboot
      this.$store.commit("system/setHasRebooted", false);
      const approved = window.confirm("Are you sure you want to restart your Umbrel?");
      if (!approved) {
        return;
      }
      // reboot request
      try {
        await this.$store.dispatch("system/reboot");
      } catch (e) {
        this.$bvToast.toast("Reboot failed", {
          title: "Something went wrong and Umbrel was not able to reboot",
          autoHideDelay: 3000,
          variant: "danger",
          solid: true,
          toaster: "b-toaster-bottom-right"
        });
      }
    },
    async toggleRemoteTorAccessSwitch() {
      if(!window.confirm("Are you sure?\n\nThis will restart your Umbrel and it may take a few minutes.")) {
        return;
      }

      try {
        await this.$store.dispatch("system/toggleRemoteTorAccess", { enabled: ! this.remoteTorAccess });
        await this.$store.dispatch("system/rebootHasBegun");
      } catch (e) {
        this.$bvToast.toast("Error", {
          title: "Something went wrong and the setting could not be changed.",
          autoHideDelay: 3000,
          variant: "danger",
          solid: true,
          toaster: "b-toaster-bottom-right"
        });
      }
    }
  },
  beforeDestroy() {
    if (this.pollUpdateStatus) {
      window.clearInterval(this.pollUpdateStatus);
    }
  },
  watch: {
    currentPassword: function() {
      this.isIncorrectPassword = false;
    }
  },
  components: {
    CardWidget,
    StorageWidget,
    RamWidget,
    TemperatureWidget,
    ToggleSwitch,
    QrCode,
    InputPassword,
    InputCopy,
    InputOtpToken
  }
};
</script>

<style lang="scss" scoped>
.otp-qr-container {
  width: 220px;
  height: 220px;
  border-radius: 6px;
}

.migration-icon-container-sm {
  width: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.migration-icon-container-lg {
  width: 30px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.migration-modal-footer {
  display: flex;
  align-items: center;
  gap: 1.5rem;

  @media (max-width: 998px) {
    flex-direction: column-reverse;
  }

  .migration-button {
    @media (max-width: 998px) {
      width: 100%;
    }
  }
}
</style>
