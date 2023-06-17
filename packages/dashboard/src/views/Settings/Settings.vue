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
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                        fill="#6c757d"
                      />
                    </svg>
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
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                        fill="#6c757d"
                      />
                    </svg>
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
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                        fill="#6c757d"
                      />
                    </svg>
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
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                        fill="#6c757d"
                      />
                    </svg>
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
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 18 18"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                      fill="#ffffff"
                    />
                  </svg>
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
              <small class="d-block" style="opacity: 0.4">Transfer your data to Umbrel Home</small>
            </div>
            <b-button variant="outline-primary" size="sm" @click="openMigrationModal">Migrate</b-button>

            <!-- INTRO STEP -->
            <b-modal v-if="migrationState.migrationStep === 'intro'" id="migration-modal" ref="migration-modal" size="lg" centered hide-footer>
              <template v-slot:modal-header="{ close }">
                <div class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100">
                  <div>
                    <h3 class="mb-1">Migration Assistant</h3>
                    <p class="text-muted mb-0">Transfer your umbrelOS from a Pi-based device to Umbrel Home in 3 steps</p>
                  </div>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="" @click.stop.prevent="close">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                        fill="#6c757d"
                      />
                    </svg>
                  </a>
                </div>
              </template>
              <div class="px-3 pb-2">
                <div class="py-2">
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-sm">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6.875 7V0.75C6.875 0.58424 6.94085 0.425269 7.05806 0.308058C7.17527 0.190848 7.33424 0.125 7.5 0.125C7.66576 0.125 7.82473 0.190848 7.94194 0.308058C8.05915 0.425269 8.125 0.58424 8.125 0.75V7C8.125 7.16576 8.05915 7.32473 7.94194 7.44194C7.82473 7.55915 7.66576 7.625 7.5 7.625C7.33424 7.625 7.17527 7.55915 7.05806 7.44194C6.94085 7.32473 6.875 7.16576 6.875 7ZM11.5914 0.851562C11.4526 0.76383 11.2848 0.734251 11.1244 0.769222C10.9639 0.804193 10.8237 0.900903 10.734 1.03844C10.6443 1.17599 10.6123 1.34331 10.645 1.50424C10.6777 1.66516 10.7724 1.80677 10.9086 1.89844C12.7141 3.07578 13.75 4.93516 13.75 7C13.75 8.6576 13.0915 10.2473 11.9194 11.4194C10.7473 12.5915 9.1576 13.25 7.5 13.25C5.8424 13.25 4.25269 12.5915 3.08058 11.4194C1.90848 10.2473 1.25 8.6576 1.25 7C1.25 4.93516 2.28594 3.07578 4.09141 1.89844C4.22765 1.80677 4.32234 1.66516 4.35502 1.50424C4.38769 1.34331 4.35571 1.17599 4.266 1.03844C4.17629 0.900903 4.03606 0.804193 3.87561 0.769222C3.71517 0.734251 3.5474 0.76383 3.40859 0.851562C1.24219 2.26406 0 4.50469 0 7C2.96403e-08 8.98912 0.790176 10.8968 2.1967 12.3033C3.60322 13.7098 5.51088 14.5 7.5 14.5C9.48912 14.5 11.3968 13.7098 12.8033 12.3033C14.2098 10.8968 15 8.98912 15 7C15 4.50469 13.7578 2.26406 11.5914 0.851562Z" fill="#99C2FF"/>
                      </svg>
                    </div>
                    <p class="mb-0 ml-2">Shut down Raspberry Pi Umbrel</p>
                  </div>
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-sm">
                      <svg width="21" height="16" viewBox="0 0 21 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20.2219 7.47969L16.4719 4.97969C16.3777 4.91688 16.2683 4.88081 16.1552 4.87533C16.0422 4.86986 15.9298 4.89518 15.83 4.9486C15.7302 5.00201 15.6468 5.08152 15.5887 5.17864C15.5306 5.27575 15.4999 5.38683 15.5 5.50001V7.37501H6.125V3.62501H8.70312C8.85525 4.21417 9.21702 4.72762 9.72063 5.06913C10.2242 5.41064 10.8351 5.55675 11.4388 5.48008C12.0424 5.40341 12.5973 5.10922 12.9996 4.65265C13.4018 4.19609 13.6237 3.60849 13.6237 3.00001C13.6237 2.39152 13.4018 1.80393 12.9996 1.34736C12.5973 0.890794 12.0424 0.596603 11.4388 0.519932C10.8351 0.44326 10.2242 0.589372 9.72063 0.93088C9.21702 1.27239 8.85525 1.78584 8.70312 2.37501H6.125C5.79348 2.37501 5.47554 2.5067 5.24112 2.74112C5.0067 2.97554 4.875 3.29349 4.875 3.62501V7.37501H1.125C0.95924 7.37501 0.800269 7.44085 0.683058 7.55806C0.565848 7.67527 0.5 7.83425 0.5 8.00001C0.5 8.16577 0.565848 8.32474 0.683058 8.44195C0.800269 8.55916 0.95924 8.62501 1.125 8.62501H4.875V12.375C4.875 12.7065 5.0067 13.0245 5.24112 13.2589C5.47554 13.4933 5.79348 13.625 6.125 13.625H8.625V14.25C8.625 14.5815 8.7567 14.8995 8.99112 15.1339C9.22554 15.3683 9.54348 15.5 9.875 15.5H12.375C12.7065 15.5 13.0245 15.3683 13.2589 15.1339C13.4933 14.8995 13.625 14.5815 13.625 14.25V11.75C13.625 11.4185 13.4933 11.1005 13.2589 10.8661C13.0245 10.6317 12.7065 10.5 12.375 10.5H9.875C9.54348 10.5 9.22554 10.6317 8.99112 10.8661C8.7567 11.1005 8.625 11.4185 8.625 11.75V12.375H6.125V8.62501H15.5V10.5C15.4999 10.6132 15.5306 10.7243 15.5887 10.8214C15.6468 10.9185 15.7302 10.998 15.83 11.0514C15.9298 11.1048 16.0422 11.1302 16.1552 11.1247C16.2683 11.1192 16.3777 11.0831 16.4719 11.0203L20.2219 8.52032C20.3076 8.46327 20.3779 8.38591 20.4265 8.29514C20.4752 8.20437 20.5006 8.10298 20.5006 8.00001C20.5006 7.89703 20.4752 7.79564 20.4265 7.70487C20.3779 7.6141 20.3076 7.53675 20.2219 7.47969ZM11.125 1.75001C11.3722 1.75001 11.6139 1.82332 11.8195 1.96067C12.025 2.09802 12.1852 2.29324 12.2798 2.52165C12.3745 2.75006 12.3992 3.00139 12.351 3.24387C12.3028 3.48635 12.1837 3.70907 12.0089 3.88389C11.8341 4.0587 11.6113 4.17776 11.3689 4.22599C11.1264 4.27422 10.8751 4.24947 10.6466 4.15486C10.4182 4.06025 10.223 3.90003 10.0857 3.69447C9.94831 3.48891 9.875 3.24723 9.875 3.00001C9.875 2.66849 10.0067 2.35054 10.2411 2.11612C10.4755 1.8817 10.7935 1.75001 11.125 1.75001ZM9.875 11.75H12.375V14.25H9.875V11.75ZM16.75 9.33204V6.67188L18.7484 8.00001L16.75 9.33204Z" fill="#99C2FF"/>
                      </svg>
                    </div>
                    <p class="mb-0 ml-2">Connect its SSD to Umbrel Home via USB</p>
                  </div>
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-sm">
                      <svg width="15" height="14" viewBox="0 0 15 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14.8172 7.44217L9.19219 13.0672C9.07491 13.1844 8.91585 13.2503 8.75 13.2503C8.58415 13.2503 8.42509 13.1844 8.30781 13.0672C8.19054 12.9499 8.12465 12.7908 8.12465 12.625C8.12465 12.4591 8.19054 12.3001 8.30781 12.1828L12.8664 7.62498H0.625C0.45924 7.62498 0.300269 7.55913 0.183058 7.44192C0.0658481 7.32471 0 7.16574 0 6.99998C0 6.83422 0.0658481 6.67525 0.183058 6.55804C0.300269 6.44083 0.45924 6.37498 0.625 6.37498H12.8664L8.30781 1.81717C8.19054 1.69989 8.12465 1.54083 8.12465 1.37498C8.12465 1.20913 8.19054 1.05007 8.30781 0.932794C8.42509 0.815518 8.58415 0.749634 8.75 0.749634C8.91585 0.749634 9.07491 0.815518 9.19219 0.932794L14.8172 6.55779C14.8753 6.61584 14.9214 6.68477 14.9529 6.76064C14.9843 6.83652 15.0005 6.91785 15.0005 6.99998C15.0005 7.08212 14.9843 7.16345 14.9529 7.23932C14.9214 7.31519 14.8753 7.38412 14.8172 7.44217Z" fill="#99C2FF"/>
                      </svg>
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
                        <svg width="19" height="18" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9.49999 4.62504C9.66575 4.62504 9.82472 4.69089 9.94193 4.8081C10.0591 4.92531 10.125 5.08428 10.125 5.25004V9.62504C10.125 9.7908 10.0591 9.94977 9.94193 10.067C9.82472 10.1842 9.66575 10.25 9.49999 10.25C9.33423 10.25 9.17526 10.1842 9.05805 10.067C8.94084 9.94977 8.87499 9.7908 8.87499 9.62504V5.25004C8.87499 5.08428 8.94084 4.92531 9.05805 4.8081C9.17526 4.69089 9.33423 4.62504 9.49999 4.62504ZM8.56249 12.4375C8.56249 12.623 8.61747 12.8042 8.72049 12.9584C8.8235 13.1126 8.96992 13.2327 9.14122 13.3037C9.31253 13.3746 9.50103 13.3932 9.68289 13.357C9.86474 13.3209 10.0318 13.2316 10.1629 13.1005C10.294 12.9693 10.3833 12.8023 10.4195 12.6204C10.4557 12.4386 10.4371 12.2501 10.3661 12.0788C10.2952 11.9075 10.175 11.761 10.0208 11.658C9.86667 11.555 9.68541 11.5 9.49999 11.5C9.25135 11.5 9.01289 11.5988 8.83708 11.7746C8.66126 11.9504 8.56249 12.1889 8.56249 12.4375ZM18.25 9.00004C18.2505 9.16375 18.2184 9.32594 18.1558 9.4772C18.0932 9.62846 18.0012 9.76581 17.8851 9.88129L10.3812 17.386C10.147 17.6188 9.83022 17.7495 9.49999 17.7495C9.16976 17.7495 8.85294 17.6188 8.61874 17.386L1.11874 9.88129C0.885926 9.64709 0.755249 9.33027 0.755249 9.00004C0.755249 8.66981 0.885926 8.35299 1.11874 8.11879L8.62265 0.614101C8.85685 0.381288 9.17366 0.25061 9.5039 0.25061C9.83413 0.25061 10.1509 0.381288 10.3851 0.614101L17.8891 8.11879C18.0044 8.23459 18.0957 8.37208 18.1576 8.52333C18.2196 8.67458 18.251 8.8366 18.25 9.00004ZM17 9.00004L9.49999 1.50004L1.99999 9.00004L9.49999 16.5L17 9.00004Z" fill="#7B2E32"/>
                      </svg>
                        The data in Umbrel Home, if any, will be permanently deleted</p>
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
                    <p class="text-muted mb-0">umbrelOS is ready to be migrated to Umbrel Home</p>
                  </div>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="" @click.stop.prevent="close">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                        fill="#6c757d"
                      />
                    </svg>
                  </a>
                </div>
              </template>
              <div class="px-3 pb-2">
                <div class="py-2">
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-lg">
                      <svg width="27" height="20" viewBox="0 0 27 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M24.5 0H2.5C1.96957 0 1.46086 0.210714 1.08579 0.585786C0.710714 0.960859 0.5 1.46957 0.5 2V18C0.5 18.5304 0.710714 19.0391 1.08579 19.4142C1.46086 19.7893 1.96957 20 2.5 20H24.5C25.0304 20 25.5391 19.7893 25.9142 19.4142C26.2893 19.0391 26.5 18.5304 26.5 18V2C26.5 1.46957 26.2893 0.960859 25.9142 0.585786C25.5391 0.210714 25.0304 0 24.5 0ZM5.5 15C5.5 15.2652 5.39464 15.5196 5.20711 15.7071C5.01957 15.8946 4.76522 16 4.5 16C4.23478 16 3.98043 15.8946 3.79289 15.7071C3.60536 15.5196 3.5 15.2652 3.5 15V5C3.5 4.73478 3.60536 4.48043 3.79289 4.29289C3.98043 4.10536 4.23478 4 4.5 4C4.76522 4 5.01957 4.10536 5.20711 4.29289C5.39464 4.48043 5.5 4.73478 5.5 5V15ZM14.6625 10.0238L13.1175 10.5238L14.0725 11.8363C14.1497 11.9429 14.2052 12.0638 14.2357 12.1919C14.2662 12.3201 14.2712 12.453 14.2504 12.583C14.2296 12.7131 14.1833 12.8378 14.1143 12.95C14.0453 13.0621 13.9548 13.1596 13.8481 13.2369C13.7414 13.3141 13.6206 13.3696 13.4924 13.4001C13.3643 13.4306 13.2314 13.4356 13.1013 13.4148C12.9713 13.3939 12.8466 13.3477 12.7344 13.2787C12.6222 13.2096 12.5247 13.1192 12.4475 13.0125L11.5 11.7013L10.5463 13.015C10.3903 13.2305 10.1551 13.3752 9.89241 13.4173C9.62974 13.4593 9.36111 13.3954 9.14563 13.2394C8.93014 13.0834 8.78544 12.8482 8.74336 12.5855C8.70128 12.3229 8.76527 12.0542 8.92125 11.8388L9.87625 10.5263L8.33125 10.0263C8.20641 9.98521 8.09088 9.91999 7.99125 9.8343C7.89162 9.74861 7.80984 9.64414 7.75059 9.52685C7.63091 9.28997 7.61024 9.01525 7.69312 8.76313C7.73416 8.63829 7.79939 8.52275 7.88508 8.42312C7.97076 8.32349 8.07524 8.24172 8.19253 8.18246C8.42941 8.06279 8.70413 8.04212 8.95625 8.125L10.5 8.625V7C10.5 6.73478 10.6054 6.48043 10.7929 6.29289C10.9804 6.10536 11.2348 6 11.5 6C11.7652 6 12.0196 6.10536 12.2071 6.29289C12.3946 6.48043 12.5 6.73478 12.5 7V8.625L14.0438 8.125C14.1686 8.08396 14.3003 8.06791 14.4313 8.07777C14.5624 8.08763 14.6902 8.12321 14.8075 8.18246C14.9248 8.24172 15.0292 8.32349 15.1149 8.42312C15.2006 8.52275 15.2658 8.63829 15.3069 8.76313C15.3479 8.88796 15.364 9.01966 15.3541 9.1507C15.3442 9.28174 15.3087 9.40956 15.2494 9.52685C15.1902 9.64414 15.1084 9.74861 15.0088 9.8343C14.9091 9.91999 14.7936 9.98521 14.6688 10.0263L14.6625 10.0238ZM23.6625 10.0238L22.1175 10.5238L23.0725 11.8363C23.1497 11.9429 23.2052 12.0638 23.2357 12.1919C23.2662 12.3201 23.2712 12.453 23.2504 12.583C23.2296 12.7131 23.1833 12.8378 23.1143 12.95C23.0453 13.0621 22.9548 13.1596 22.8481 13.2369C22.7414 13.3141 22.6206 13.3696 22.4924 13.4001C22.3643 13.4306 22.2314 13.4356 22.1013 13.4148C21.9713 13.3939 21.8466 13.3477 21.7344 13.2787C21.6222 13.2096 21.5247 13.1192 21.4475 13.0125L20.5 11.7013L19.5462 13.015C19.3903 13.2305 19.1551 13.3752 18.8924 13.4173C18.6297 13.4593 18.3611 13.3954 18.1456 13.2394C17.9301 13.0834 17.7854 12.8482 17.7434 12.5855C17.7013 12.3229 17.7653 12.0542 17.9212 11.8388L18.8762 10.5263L17.3312 10.0263C17.2064 9.98521 17.0909 9.91999 16.9912 9.8343C16.8916 9.74861 16.8098 9.64414 16.7506 9.52685C16.6309 9.28997 16.6102 9.01525 16.6931 8.76313C16.7342 8.63829 16.7994 8.52275 16.8851 8.42312C16.9708 8.32349 17.0752 8.24172 17.1925 8.18246C17.4294 8.06279 17.7041 8.04212 17.9562 8.125L19.5 8.625V7C19.5 6.73478 19.6054 6.48043 19.7929 6.29289C19.9804 6.10536 20.2348 6 20.5 6C20.7652 6 21.0196 6.10536 21.2071 6.29289C21.3946 6.48043 21.5 6.73478 21.5 7V8.625L23.0438 8.125C23.1686 8.08396 23.3003 8.06791 23.4313 8.07777C23.5624 8.08763 23.6902 8.12321 23.8075 8.18246C23.9248 8.24172 24.0292 8.32349 24.1149 8.42312C24.2006 8.52275 24.2658 8.63829 24.3069 8.76313C24.3479 8.88796 24.364 9.01966 24.3541 9.1507C24.3442 9.28174 24.3087 9.40956 24.2494 9.52685C24.1902 9.64414 24.1084 9.74861 24.0088 9.8343C23.9091 9.91999 23.7936 9.98521 23.6688 10.0263L23.6625 10.0238Z" fill="url(#paint0_linear_513_14052)"/>
                          <defs>
                            <linearGradient id="paint0_linear_513_14052" x1="0.5" y1="0" x2="19.8308" y2="25.1301" gradientUnits="userSpaceOnUse">
                              <stop stop-color="#9695FA"/>
                              <stop offset="1" stop-color="#6B69F3"/>
                            </linearGradient>
                          </defs>
                      </svg>
                    </div>
                    <div class="ml-2">
                      <p class="mb-0">Use your Umbrel Home password</p>
                      <p class="text-muted mb-0">Your password for your Umbrel Home will continue to be your password going forward</p>
                    </div>
                  </div>
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-lg">
                      <svg width="27" height="26" viewBox="0 0 27 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M13.5 0C10.9288 0 8.41543 0.762437 6.27759 2.1909C4.13975 3.61935 2.47351 5.64968 1.48957 8.02512C0.505633 10.4006 0.248189 13.0144 0.749797 15.5362C1.25141 18.0579 2.48953 20.3743 4.30762 22.1924C6.1257 24.0105 8.44208 25.2486 10.9638 25.7502C13.4856 26.2518 16.0995 25.9944 18.4749 25.0104C20.8503 24.0265 22.8807 22.3603 24.3091 20.2224C25.7376 18.0846 26.5 15.5712 26.5 13C26.5 9.55219 25.1304 6.24558 22.6924 3.80761C20.2544 1.36964 16.9478 0 13.5 0ZM12.5 5C12.5 4.73478 12.6054 4.48043 12.7929 4.29289C12.9804 4.10536 13.2348 4 13.5 4C13.7652 4 14.0196 4.10536 14.2071 4.29289C14.3946 4.48043 14.5 4.73478 14.5 5V13C14.5 13.2652 14.3946 13.5196 14.2071 13.7071C14.0196 13.8946 13.7652 14 13.5 14C13.2348 14 12.9804 13.8946 12.7929 13.7071C12.6054 13.5196 12.5 13.2652 12.5 13V5ZM13.5 23C11.3545 23.0002 9.26585 22.3104 7.5425 21.0324C5.81916 19.7545 4.55251 17.9562 3.92967 15.9031C3.30682 13.85 3.36079 11.651 4.08362 9.63095C4.80644 7.61089 6.15979 5.87687 7.94376 4.685C8.05272 4.60794 8.17602 4.55347 8.30637 4.5248C8.43672 4.49613 8.57148 4.49385 8.70273 4.51808C8.83398 4.54232 8.95904 4.59258 9.07056 4.6659C9.18208 4.73923 9.27779 4.83414 9.35205 4.94503C9.42632 5.05592 9.47763 5.18056 9.50297 5.3116C9.52831 5.44264 9.52716 5.57742 9.49959 5.70801C9.47203 5.83859 9.4186 5.96234 9.34246 6.07195C9.26632 6.18157 9.169 6.27483 9.05626 6.34625C7.62903 7.29964 6.54627 8.68676 5.9679 10.3027C5.38953 11.9187 5.34621 13.6779 5.84434 15.3204C6.34248 16.9628 7.35565 18.4016 8.73421 19.4241C10.1128 20.4465 11.7836 20.9985 13.5 20.9985C15.2164 20.9985 16.8872 20.4465 18.2658 19.4241C19.6444 18.4016 20.6575 16.9628 21.1557 15.3204C21.6538 13.6779 21.6105 11.9187 21.0321 10.3027C20.4537 8.68676 19.371 7.29964 17.9438 6.34625C17.831 6.27483 17.7337 6.18157 17.6576 6.07195C17.5814 5.96234 17.528 5.83859 17.5004 5.70801C17.4729 5.57742 17.4717 5.44264 17.497 5.3116C17.5224 5.18056 17.5737 5.05592 17.648 4.94503C17.7222 4.83414 17.8179 4.73923 17.9295 4.6659C18.041 4.59258 18.166 4.54232 18.2973 4.51808C18.4285 4.49385 18.5633 4.49613 18.6936 4.5248C18.824 4.55347 18.9473 4.60794 19.0563 4.685C20.8402 5.87687 22.1936 7.61089 22.9164 9.63095C23.6392 11.651 23.6932 13.85 23.0703 15.9031C22.4475 17.9562 21.1809 19.7545 19.4575 21.0324C17.7342 22.3104 15.6455 23.0002 13.5 23Z" fill="url(#paint0_linear_513_14058)"/>
                          <defs>
                            <linearGradient id="paint0_linear_513_14058" x1="6.36958" y1="5.86958" x2="20.2576" y2="19.7576" gradientUnits="userSpaceOnUse">
                              <stop stop-color="#FF767F"/>
                              <stop offset="1" stop-color="#FF4756"/>
                            </linearGradient>
                          </defs>
                        </svg>
                    </div>
                    <div class="ml-2">
                      <p class="mb-0">Keep your Raspberry Pi off after the update</p>
                      <p class="text-muted mb-0">This helps prevent issues with apps such as Lightning Node</p>
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
                        <svg width="19" height="18" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M9.49999 4.62504C9.66575 4.62504 9.82472 4.69089 9.94193 4.8081C10.0591 4.92531 10.125 5.08428 10.125 5.25004V9.62504C10.125 9.7908 10.0591 9.94977 9.94193 10.067C9.82472 10.1842 9.66575 10.25 9.49999 10.25C9.33423 10.25 9.17526 10.1842 9.05805 10.067C8.94084 9.94977 8.87499 9.7908 8.87499 9.62504V5.25004C8.87499 5.08428 8.94084 4.92531 9.05805 4.8081C9.17526 4.69089 9.33423 4.62504 9.49999 4.62504ZM8.56249 12.4375C8.56249 12.623 8.61747 12.8042 8.72049 12.9584C8.8235 13.1126 8.96992 13.2327 9.14122 13.3037C9.31253 13.3746 9.50103 13.3932 9.68289 13.357C9.86474 13.3209 10.0318 13.2316 10.1629 13.1005C10.294 12.9693 10.3833 12.8023 10.4195 12.6204C10.4557 12.4386 10.4371 12.2501 10.3661 12.0788C10.2952 11.9075 10.175 11.761 10.0208 11.658C9.86667 11.555 9.68541 11.5 9.49999 11.5C9.25135 11.5 9.01289 11.5988 8.83708 11.7746C8.66126 11.9504 8.56249 12.1889 8.56249 12.4375ZM18.25 9.00004C18.2505 9.16375 18.2184 9.32594 18.1558 9.4772C18.0932 9.62846 18.0012 9.76581 17.8851 9.88129L10.3812 17.386C10.147 17.6188 9.83022 17.7495 9.49999 17.7495C9.16976 17.7495 8.85294 17.6188 8.61874 17.386L1.11874 9.88129C0.885926 9.64709 0.755249 9.33027 0.755249 9.00004C0.755249 8.66981 0.885926 8.35299 1.11874 8.11879L8.62265 0.614101C8.85685 0.381288 9.17366 0.25061 9.5039 0.25061C9.83413 0.25061 10.1509 0.381288 10.3851 0.614101L17.8891 8.11879C18.0044 8.23459 18.0957 8.37208 18.1576 8.52333C18.2196 8.67458 18.251 8.8366 18.25 9.00004ZM17 9.00004L9.49999 1.50004L1.99999 9.00004L9.49999 16.5L17 9.00004Z" fill="#7B2E32"/>
                        </svg>
                        The data in Umbrel Home, if any, will be permanently deleted.</p>
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
                    <p class="text-muted mb-0">fix the following errors and try again</p>
                  </div>
                  <!-- Emulate built in modal header close button action -->
                  <a href="#" class="" @click.stop.prevent="close">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                        fill="#6c757d"
                      />
                    </svg>
                  </a>
                </div>
              </template>
              <div class="px-3 pb-2">
                <div class="py-2">
                  <div class="d-flex align-items-center mb-3">
                    <div class="migration-icon-container-lg">
                      <svg width="29" height="25" viewBox="0 0 29 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M28.0999 20.5112L17.1686 1.52746C16.8955 1.06237 16.5055 0.676734 16.0374 0.408786C15.5693 0.140838 15.0393 -0.00012207 14.4999 -0.00012207C13.9605 -0.00012207 13.4305 0.140838 12.9624 0.408786C12.4943 0.676734 12.1043 1.06237 11.8311 1.52746L0.899876 20.5112C0.637046 20.9611 0.498535 21.4727 0.498535 21.9937C0.498535 22.5147 0.637046 23.0264 0.899876 23.4762C1.16954 23.9441 1.55884 24.3318 2.02783 24.5996C2.49682 24.8674 3.02861 25.0056 3.56863 25H25.4311C25.9707 25.0051 26.502 24.8667 26.9705 24.599C27.439 24.3312 27.8279 23.9437 28.0974 23.4762C28.3606 23.0266 28.4995 22.5151 28.5 21.994C28.5004 21.473 28.3623 20.9613 28.0999 20.5112ZM13.4999 9.99996C13.4999 9.73474 13.6052 9.48039 13.7928 9.29285C13.9803 9.10532 14.2347 8.99996 14.4999 8.99996C14.7651 8.99996 15.0194 9.10532 15.207 9.29285C15.3945 9.48039 15.4999 9.73474 15.4999 9.99996V15C15.4999 15.2652 15.3945 15.5195 15.207 15.7071C15.0194 15.8946 14.7651 16 14.4999 16C14.2347 16 13.9803 15.8946 13.7928 15.7071C13.6052 15.5195 13.4999 15.2652 13.4999 15V9.99996ZM14.4999 21C14.2032 21 13.9132 20.912 13.6665 20.7472C13.4198 20.5823 13.2276 20.3481 13.1141 20.074C13.0005 19.7999 12.9708 19.4983 13.0287 19.2073C13.0866 18.9164 13.2294 18.6491 13.4392 18.4393C13.649 18.2295 13.9163 18.0867 14.2072 18.0288C14.4982 17.9709 14.7998 18.0006 15.0739 18.1141C15.348 18.2277 15.5823 18.4199 15.7471 18.6666C15.9119 18.9133 15.9999 19.2033 15.9999 19.5C15.9999 19.8978 15.8418 20.2793 15.5605 20.5606C15.2792 20.8419 14.8977 21 14.4999 21Z" fill="#FFC107"/>
                      </svg>
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
            <span class="align-self-end">Umbrel Version</span>
            <span class="font-weight-normal mb-0">{{ version }}</span>
          </div>
          <div v-show="!isCheckingForUpdate">
            <span v-show="!availableUpdate.version">
              <b-icon icon="check-circle-fill" variant="success"></b-icon>
              <small class="ml-1" style="opacity: 0.4">Your Umbrel is on the latest version</small>
            </span>
            <div v-show="availableUpdate.version">
              <span class="d-block">
                <b-icon icon="bell-fill" variant="success"></b-icon>
                <small
                  class="text-muted ml-1"
                >Umbrel {{availableUpdate.version}} is now available to install</small>
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
        migrationError: null
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
    async canMigrate() {
      this.migrationState.isCheckingMigration = true;
      this.migrationState.migrationError = null;
      this.migrationCheckFailed = false;

      try {
        const response = await API.umbreldGet(`${API.umbreldUrl}/can-migrate`);
        console.log(response);
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
      // TODO: should I handle non-catch errors in this one?
      this.migrationState.isMigrating = true;
      this.migrationState.migrationError = null;

      try {
        await API.post(`${API.umbreldUrl}/migrate`);

        // poll migrate status every second until migration is running (checking regularly to transition quickly)
        // because after it's running, the loading view will take over
        this.pollMigrateStatus = window.setInterval(async () => {
          await this.$store.dispatch("system/getMigrateStatus");
          if (this.migrateStatus.running === true) {
            window.clearInterval(this.pollMigrateStatus);
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
