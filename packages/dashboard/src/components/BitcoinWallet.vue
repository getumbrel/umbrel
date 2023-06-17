<template>
  <card-widget
    header="Bitcoin Wallet"
    :status="{
      text: lightningSyncPercent < 100 ? 'Synchronizing' : 'Active',
      variant: 'success',
      blink: false
    }"
    :sub-title="unit | formatUnit"
    icon="icon-app-bitcoin.svg"
    :loading="
      loading ||
        (transactions.length > 0 && transactions[0]['type'] === 'loading') ||
        lightningSyncPercent < 100
    "
  >
    <template v-slot:title>
      <div
        v-b-tooltip.hover.right
        :title="walletBalanceInSats | satsToUSD"
        v-if="walletBalance !== -1"
      >
        <CountUp
          :value="{
            endVal: walletBalance,
            decimalPlaces: unit === 'sats' ? 0 : 5
          }"
        />
      </div>
      <span
        class="loading-placeholder loading-placeholder-lg"
        style="width: 140px;"
        v-else
      ></span>
    </template>
    <div class="wallet-content">
      <!-- transition switching between different modes -->
      <transition name="lightning-mode-change" mode="out-in" tag="div">
        <!-- Default Balance/tx screen -->
        <div
          v-if="mode === 'transactions'"
          key="mode-balance"
          class="wallet-mode mode-balance"
        >
          <!-- List of transactions -->
          <!-- No transactions -->
          <div
            class="d-flex flex-column justify-content-center px-3 px-lg-4 zero-wallet-transactions-container"
            v-if="transactions.length === 0"
          >
            <svg
              width="150"
              height="150"
              viewBox="0 0 150 150"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              class="align-self-center"
            >
              <path
                d="M123.78 79.2812C122.574 79.2812 121.597 80.2586 121.597 81.4642C121.597 82.9926 120.354 84.2359 118.825 84.2359C117.297 84.2359 116.054 82.9926 116.054 81.4642C116.054 80.2583 115.076 79.2812 113.871 79.2812C112.665 79.2812 111.688 80.2586 111.688 81.4642C111.688 85.3999 114.89 88.6018 118.825 88.6018C122.761 88.6018 125.963 85.3996 125.963 81.4642C125.963 80.258 124.986 79.2812 123.78 79.2812Z"
                fill="#EDEEF1"
              />
              <path
                d="M144.271 79.6377L138.127 77.6695C137.34 77.4173 136.719 76.7892 136.468 75.9891C135.173 71.872 133.219 68.0068 130.66 64.5006C129.493 62.9025 128.196 61.3764 126.78 59.9235C127.686 55.9471 128.179 51.4468 128.115 47.5588C128.024 41.9968 126.912 38.7346 124.717 37.585C123.535 36.965 119.937 35.0818 100.465 43.9957C100.003 44.2066 99.5728 44.4665 99.174 44.7642C97.8612 44.4114 96.5194 44.0851 95.1694 43.7921C95.0068 43.7566 94.8393 43.7253 94.6755 43.6907C96.2534 40.2437 97.1748 36.4998 97.348 32.635C97.4019 31.4303 96.4693 30.4102 95.2647 30.3565C94.0632 30.2968 93.0398 31.2349 92.9862 32.4396C92.7018 38.7943 90.0656 44.7735 85.5639 49.2756C82.8741 51.9653 79.7247 53.9192 76.3682 55.1496C70.5472 54.3328 64.6181 54.3328 58.7971 55.1496C55.4402 53.9192 52.2911 51.9653 49.6014 49.2756C44.7984 44.4727 42.1532 38.0868 42.1532 31.2943C42.1532 24.5016 44.7984 18.116 49.6014 13.3131C54.4043 8.50987 60.7904 5.86465 67.5826 5.86465C74.3748 5.86465 80.7609 8.50987 85.5639 13.3131C87.4939 15.2432 89.0889 17.4457 90.3044 19.8589C90.8467 20.9358 92.1595 21.3694 93.2361 20.8269C94.3131 20.2849 94.7464 18.9721 94.2041 17.8954C92.7794 15.0656 90.9111 12.4855 88.6515 10.2255C83.0238 4.59785 75.5414 1.49854 67.5829 1.49854C59.6244 1.49854 52.142 4.59785 46.5144 10.2255C40.8867 15.8534 37.7874 23.3356 37.7874 31.2941C37.7874 39.2525 40.8867 46.735 46.5144 52.3626C48.1377 53.9859 49.9037 55.3819 51.7717 56.5515C51.7723 56.5515 51.7729 56.5512 51.7734 56.5512C50.4161 56.9039 49.069 57.3 47.7369 57.7453C46.5935 58.1276 45.9765 59.3643 46.3588 60.508C46.7408 61.6515 47.978 62.2685 49.1212 61.8864C61.0263 57.9065 74.1396 57.9065 86.0446 61.8864C86.2743 61.9632 86.5075 61.9995 86.7369 61.9995C87.6501 61.9995 88.5015 61.4218 88.807 60.508C89.1894 59.3646 88.5724 58.1276 87.4289 57.7453C86.0968 57.3 84.7497 56.9036 83.3924 56.5512C83.393 56.5512 83.3936 56.5515 83.3941 56.5515C85.2624 55.3819 87.0281 53.9859 88.6515 52.3626C90.0876 50.9265 91.3553 49.3582 92.456 47.6915C93.0577 47.8084 93.6551 47.9309 94.2437 48.0586C95.0276 48.2288 95.8081 48.4116 96.5815 48.6035C96.5572 48.6984 96.5323 48.7931 96.5121 48.8895C95.4475 53.9417 95.5166 58.4101 96.7175 62.1697C97.7968 65.5491 99.7447 68.2869 102.507 70.3075C105.762 72.6888 109.692 73.7174 113.251 73.7174C115.931 73.7174 118.401 73.1344 120.215 72.1069C122.267 70.9447 123.986 68.4958 125.347 64.8191C125.976 65.5532 126.572 66.3053 127.134 67.0752C129.412 70.1965 131.152 73.6365 132.304 77.2992C132.98 79.4505 134.659 81.1433 136.795 81.8279L142.939 83.7961C144.552 84.3126 145.635 85.7965 145.635 87.4893V97.6773C145.635 99.37 144.552 100.854 142.939 101.37L133.04 104.541C131.457 105.049 130.116 106.137 129.266 107.606C125.377 114.328 119.263 119.89 111.091 124.138C110.147 124.629 109.494 125.508 109.297 126.549L106.126 143.337C106.039 143.8 105.633 144.135 105.163 144.135H94.8539C94.3831 144.135 93.9779 143.799 93.8903 143.337L92.1343 134.059C91.7886 132.234 90.0765 131.021 88.2337 131.3C83.7932 131.972 79.2176 132.312 74.6347 132.312C71.2251 132.312 67.8592 132.122 64.6298 131.746C62.8441 131.541 61.1807 132.758 60.847 134.521L59.1782 143.337C59.0906 143.8 58.6854 144.135 58.2146 144.135H47.906C47.4352 144.135 47.03 143.799 46.9412 143.33L43.8885 127.474C43.6919 126.452 43.0503 125.584 42.1272 125.091C28.1982 117.655 20.8359 105.232 20.8359 89.1654C20.8359 81.0478 22.6119 73.8697 26.1144 67.8299C29.3827 62.1935 34.1563 57.5332 40.3025 53.978C41.3461 53.3742 41.7026 52.0389 41.0991 50.995C40.4956 49.9515 39.1603 49.5955 38.1164 50.1984C26.1987 57.0926 19.0107 67.7285 17.0317 81.2373V81.237C16.8217 81.218 16.6113 81.1998 16.4019 81.1781C16.4399 79.7206 16.1763 78.2499 15.6021 76.8226C14.3355 73.6743 11.734 71.4021 8.97393 71.0338C6.79893 70.7426 4.7291 71.666 3.29268 73.5639C1.20996 76.316 1.54951 78.494 2.20078 79.8363C3.30029 82.1019 6.12656 83.7044 10.8167 84.7119C10.6878 84.905 10.546 85.0989 10.3907 85.2938C7.61953 88.7693 4.35469 89.5377 2.23477 89.6101C0.99375 89.652 0 90.6484 0 91.8903V91.9008C0 93.1257 0.966504 94.1247 2.19023 94.1807C2.34697 94.188 2.51074 94.1918 2.68125 94.1918C5.36367 94.1918 9.66885 93.2025 13.805 88.016C14.458 87.1975 14.99 86.3338 15.399 85.4414C15.8109 85.488 16.2067 85.5278 16.5858 85.563C16.5858 85.5621 16.5858 85.5615 16.5861 85.5607C16.5117 86.7437 16.4704 87.944 16.4704 89.1654C16.4704 98.2556 18.6375 106.361 22.911 113.256C26.8515 119.614 32.4932 124.819 39.685 128.734L42.6527 144.149C43.13 146.67 45.3393 148.501 47.906 148.501H58.2146C60.7813 148.501 62.9906 146.67 63.4679 144.149L64.9767 136.177C68.1103 136.509 71.3546 136.678 74.6344 136.678C79.1344 136.678 83.6291 136.364 88.0096 135.745L89.6001 144.149C90.0776 146.671 92.2869 148.501 94.8533 148.501H105.162C107.729 148.501 109.938 146.671 110.416 144.148L113.503 127.803C122.224 123.191 128.797 117.133 133.045 109.793C133.351 109.264 133.822 108.875 134.372 108.699L144.271 105.529C147.698 104.43 150 101.275 150 97.6767V87.4887C150 83.8904 147.698 80.7355 144.271 79.6377ZM123.421 53.6933C122.581 60.8786 120.327 67.0251 118.063 68.3077C115.489 69.7658 109.546 70.0474 105.084 66.7834C100.617 63.5156 99.1298 57.6393 100.784 49.7895C100.784 49.7892 100.784 49.7892 100.784 49.7892C100.95 49.0008 101.51 48.3188 102.282 47.9654C113.211 42.9627 119.512 41.3265 121.852 41.3265C122.206 41.3265 122.469 41.3637 122.644 41.4322C123.347 42.1816 124.269 46.4417 123.421 53.6933ZM6.1292 77.93C5.90332 77.4642 6.43652 76.6453 6.77461 76.1983C7.31045 75.4904 7.8041 75.3457 8.17705 75.3457C8.25586 75.3457 8.32939 75.3522 8.39678 75.3612C9.40049 75.4951 10.8067 76.5996 11.5518 78.4515C11.7272 78.8874 11.9552 79.6096 12.0085 80.5102C8.98652 79.8841 6.63867 78.9815 6.1292 77.93Z"
                fill="#EDEEF1"
              />
              <path
                d="M74.2921 31.0069C75.5592 30.1946 76.5382 28.8858 76.9135 27.2732C77.5873 24.379 76.0844 21.5286 73.5192 20.5162L74.1134 17.9642L70.9693 17.2444L70.3946 19.7131L67.2506 18.9933L67.8253 16.5245L64.6814 15.8047L64.1067 18.2734L62.5347 17.9135L61.7684 21.2053L63.3404 21.5652L60.2753 34.732L58.7033 34.372L57.937 37.6638L59.509 38.0238L58.7427 41.3154L61.8867 42.0353L62.653 38.7437L65.797 39.4634L65.0307 42.7552L68.1746 43.475L68.9603 40.1002C71.7134 40.3054 74.3241 38.3968 74.9979 35.5025C75.3732 33.89 75.0718 32.288 74.2921 31.0069ZM73.7696 26.5534C73.4526 27.9148 72.1372 28.78 70.8369 28.4823L65.3349 27.2225L66.4844 22.285L71.9862 23.5447C73.2866 23.8424 74.0865 25.192 73.7696 26.5534ZM68.9212 36.7115L63.4192 35.4517L64.5686 30.5143L70.0706 31.7739C71.3708 32.0717 72.1708 33.4212 71.8538 34.7827C71.5369 36.144 70.2214 37.0093 68.9212 36.7115Z"
                fill="#EDEEF1"
              />
            </svg>

            <small class="align-self-center mt-3 text-muted"
              >No transactions</small
            >
          </div>

          <div class="wallet-transactions-container" v-else>
            <transition-group
              name="slide-up"
              class="list-group pb-2 transactions"
            >
              <!-- Transaction -->
              <b-list-group-item
                v-for="tx in transactions"
                :key="tx.hash"
                class="flex-column align-items-start px-3 px-lg-4"
                :href="getTxExplorerUrl(tx.hash)"
                target="_blank"
                @click="openTxInExplorer"
              >
                <!-- Loading Transactions Placeholder -->
                <div
                  class="d-flex w-100 justify-content-between"
                  v-if="tx.type === 'loading'"
                >
                  <div class="w-50">
                    <span class="loading-placeholder"></span>

                    <!-- Timestamp of tx -->
                    <span
                      class="loading-placeholder loading-placeholder-sm"
                      style="width: 40%"
                    ></span>
                  </div>

                  <div class="w-25 text-right">
                    <span class="loading-placeholder"></span>
                    <span
                      class="loading-placeholder loading-placeholder-sm"
                      style="width: 30%"
                    ></span>
                  </div>
                </div>

                <div class="d-flex w-100 justify-content-between" v-else>
                  <div class="transaction-description">
                    <h6
                      class="mb-0 font-weight-normal transaction-description-text"
                    >
                      <!-- Incoming tx icon -->
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        v-if="tx.type === 'incoming' && tx.confirmations > 0"
                      >
                        <path
                          d="M13.5944 6.04611C13.6001 5.73904 13.3493 5.48755 13.0369 5.48712C12.7351 5.4867 12.4836 5.7375 12.4836 6.03895L12.4758 11.6999L4.94598 3.83615C4.72819 3.61848 4.16402 3.62477 3.94599 3.8422C3.72796 4.05963 3.73466 4.62433 3.95209 4.84236L11.6871 12.4864L6.03143 12.4733C5.72435 12.4782 5.47251 12.7293 5.47244 13.0308C5.47201 13.3431 5.72317 13.595 6.0299 13.5898L13.031 13.5994C13.3381 13.6051 13.5896 13.3543 13.5844 13.0476L13.5944 6.04611Z"
                          fill="#00CD98"
                        />
                      </svg>

                      <!-- Outgoing tx icon -->
                      <svg
                        width="19"
                        height="19"
                        viewBox="0 0 19 19"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        v-else-if="
                          tx.type === 'outgoing' && tx.confirmations > 0
                        "
                      >
                        <path
                          d="M7.06802 4.71946C6.76099 4.71224 6.50825 4.96178 6.50627 5.27413C6.50435 5.57592 6.7539 5.82865 7.05534 5.83022L12.7162 5.86616L4.81508 13.3568C4.59632 13.5735 4.59981 14.1376 4.81615 14.3568C5.03249 14.5759 5.59723 14.572 5.81634 14.3556L13.4988 6.6587L13.4576 12.3143C13.4609 12.6214 13.7108 12.8745 14.0122 12.876C14.3246 12.878 14.5777 12.6281 14.574 12.3214L14.6184 5.32036C14.6257 5.01333 14.3761 4.76059 14.0694 4.76427L7.06802 4.71946Z"
                          fill="#5351FB"
                        />
                      </svg>

                      <!-- Pending tx -->
                      <svg class="icon-clock" viewBox="0 0 40 40" v-else>
                        <circle cx="20" cy="20" r="18" />
                        <line x1="0" y1="0" x2="8" y2="0" class="hour" />
                        <line x1="0" y1="0" x2="12" y2="0" class="minute" />
                      </svg>

                      <!-- tx description -->
                      <span style="margin-left: 6px;" :title="tx.description">{{
                        tx.description
                      }}</span>
                    </h6>

                    <!-- Timestamp of tx -->
                    <!-- TODO: Clean this -->
                    <small
                      class="text-muted mt-0 tx-timestamp"
                      :style="
                        tx.confirmations > 0
                          ? 'margin-left: 25px;'
                          : 'margin-left: 21px;'
                      "
                      v-b-tooltip.hover.bottomright
                      :title="
                        `${getReadableTime(tx.timestamp)} | ${
                          tx.confirmations
                        } confirmations`
                      "
                      v-if="tx.type === 'outgoing' || tx.type === 'incoming'"
                    >
                      {{ getTimeFromNow(tx.timestamp) }}
                      <span
                        v-if="
                          tx.description === 'Lightning Wallet' &&
                            tx.type === 'outgoing'
                        "
                        >&bull; Channel open</span
                      >
                      <span
                        v-else-if="
                          tx.description === 'Lightning Wallet' &&
                            tx.type === 'incoming'
                        "
                        >&bull; Channel close</span
                      >
                    </small>
                  </div>

                  <div class="text-right">
                    <span
                      class="font-weight-bold d-block"
                      v-b-tooltip.hover.left
                      :title="tx.amount | satsToUSD"
                    >
                      <!-- Positive or negative prefix with amount -->
                      <span v-if="tx.type === 'incoming'">+</span>
                      <span v-else-if="tx.type === 'outgoing'">-</span>
                      {{ tx.amount | unit | localize }}
                    </span>
                    <small class="text-muted">{{ unit | formatUnit }}</small>
                  </div>
                </div>
              </b-list-group-item>
            </transition-group>
          </div>
        </div>

        <!-- SCREEN/MODE: Withdraw Screen -->
        <div
          class="wallet-mode"
          v-else-if="mode === 'withdraw'"
          key="mode-withdraw"
        >
          <div class="px-3 px-lg-4">
            <!-- Back Button -->
            <div class="pb-3">
              <a
                href="#"
                class="card-link text-muted"
                v-on:click.stop.prevent="reset"
              >
                <svg
                  width="7"
                  height="13"
                  viewBox="0 0 7 13"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6.74372 11.4153C7.08543 11.7779 7.08543 12.3659 6.74372 12.7285C6.40201 13.0911 5.84799 13.0911 5.50628 12.7285L0.256283 7.15709C-0.0749738 6.80555 -0.0865638 6.23951 0.229991 5.87303L5.04249 0.301606C5.36903 -0.0764332 5.92253 -0.101971 6.27876 0.244565C6.63499 0.591101 6.65905 1.17848 6.33251 1.55652L2.08612 6.47256L6.74372 11.4153Z"
                    fill="#C3C6D1"
                  />
                </svg>
                Back
              </a>
            </div>
            <div class="mb-0">
              <div class="w-100 d-flex justify-content-between">
                <label class="sr-onlsy" for="input-withdrawal-amount"
                  >Amount</label
                >
                <b-form-checkbox v-model="withdraw.sweep" size="sm" switch>
                  <small class="text-muted">Max</small>
                </b-form-checkbox>
              </div>
              <b-input-group class="neu-input-group">
                <b-input
                  id="input-withdrawal-amount"
                  class="neu-input"
                  type="text"
                  size="lg"
                  v-model="withdraw.amountInput"
                  autofocus
                  @input="fetchWithdrawalFees"
                  style="padding-right: 82px"
                  :disabled="withdraw.sweep"
                ></b-input>
                <b-input-group-append class="neu-input-group-append">
                  <sats-btc-switch
                    class="align-self-center"
                    size="sm"
                  ></sats-btc-switch>
                </b-input-group-append>
              </b-input-group>
              <div class="w-100 d-flex justify-content-between">
                <div></div>
                <small
                  class="text-muted mt-1 d-block text-right mb-0"
                  :style="{ opacity: withdraw.amount > 0 ? 1 : 0 }"
                  >~ {{ withdraw.amount | satsToUSD }}</small
                >
              </div>
            </div>

            <label class="sr-onlsy" for="input-withdrawal-address"
              >Address</label
            >
            <b-input
              id="input-withdrawal-address"
              class="mb-2 neu-input"
              type="text"
              size="lg"
              min="1"
              v-model="withdraw.address"
              @input="fetchWithdrawalFees"
            ></b-input>
          </div>
          <div class="px-3 px-lg-4 mt-1" v-show="!error">
            <fee-selector
              :fee="this.fees"
              :disabled="!withdraw.amount || !withdraw.address"
              @change="selectWithdrawalFee"
            ></fee-selector>
          </div>
        </div>

        <!-- SCREEN/MODE: Review Withdrawal -->
        <div
          class="wallet-mode"
          v-else-if="mode === 'review-withdraw'"
          key=" ode-review-withdraw"
        >
          <div class="px-3 px-lg-4">
            <!-- Back Button -->
            <div class="pt-2 pb-3">
              <a
                href="#"
                class="card-link text-muted"
                v-on:click.stop.prevent="reset"
              >
                <svg
                  width="7"
                  height="13"
                  viewBox="0 0 7 13"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6.74372 11.4153C7.08543 11.7779 7.08543 12.3659 6.74372 12.7285C6.40201 13.0911 5.84799 13.0911 5.50628 12.7285L0.256283 7.15709C-0.0749738 6.80555 -0.0865638 6.23951 0.229991 5.87303L5.04249 0.301606C5.36903 -0.0764332 5.92253 -0.101971 6.27876 0.244565C6.63499 0.591101 6.65905 1.17848 6.33251 1.55652L2.08612 6.47256L6.74372 11.4153Z"
                    fill="#C3C6D1"
                  />
                </svg>
                Back
              </a>
            </div>
            <div class="text-center pb-4">
              <h3 class="mb-0">{{ withdraw.amount | unit | localize }}</h3>
              <span class="d-block mb-1 text-muted">
                {{ unit | formatUnit }}
              </span>
              <small class="text-muted d-block mb-3"
                >~ {{ withdraw.amount | satsToUSD }}</small
              >

              <svg
                width="30"
                height="30"
                viewBox="0 0 30 30"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="14.9993" cy="14.9995" r="15" fill="#00CD98" />
                <path
                  d="M19.8736 16.3735C20.0938 16.1594 20.0927 15.8043 19.8711 15.5841C19.6571 15.3713 19.3019 15.3724 19.0897 15.5865L15.099 19.6016L15.2869 8.71577C15.2854 8.40786 14.8803 8.01517 14.5724 8.01611C14.2645 8.01706 13.8717 8.42285 13.8726 8.73076L13.9852 19.605L9.97755 15.6143C9.75604 15.4016 9.40037 15.4027 9.18811 15.6168C8.96793 15.8383 8.96902 16.194 9.19053 16.4062L14.1562 21.3416C14.3703 21.5618 14.7255 21.5607 14.9377 21.3392L19.8736 16.3735Z"
                  fill="#F7F9FB"
                />
              </svg>

              <b class="d-block mt-3">{{ withdraw.address }}</b>
            </div>
            <div
              class="d-flex justify-content-between pb-3"
              v-if="withdraw.selectedFee.type === 'custom'"
            >
              <span class="text-muted">
                <b>
                  {{ withdraw.selectedFee.satPerByte }}
                </b>
                <small>&nbsp;sat/vB</small>
                <br />
                <small>
                  ~
                  {{
                    ((parseInt(fees.fast.total, 10) /
                      parseInt(fees.fast.perByte, 10)) *
                      parseInt(withdraw.selectedFee.satPerByte, 10))
                      | satsToUSD
                  }}
                  Transaction fee
                </small>
              </span>
              <span class="text-right text-muted">
                <b>{{ projectedBalanceInSats | unit | localize }}</b>
                <small>&nbsp;{{ unit | formatUnit }}</small>
                <br />
                <small>Remaining balance</small>
              </span>
            </div>
            <div class="d-flex justify-content-between pb-3" v-else>
              <span class="text-muted">
                <b>
                  {{
                    fees[withdraw.selectedFee.type]["total"] | unit | localize
                  }}
                </b>
                <small>&nbsp;{{ unit | formatUnit }}</small>
                <br />
                <small>
                  ~
                  {{ fees[withdraw.selectedFee.type]["total"] | satsToUSD }}
                  Transaction fee
                </small>
              </span>
              <span class="text-right text-muted">
                <b>{{ projectedBalanceInSats | unit | localize }}</b>
                <small>&nbsp;{{ unit | formatUnit }}</small>
                <br />
                <small>Remaining balance</small>
              </span>
            </div>
          </div>
        </div>

        <!-- SCREEN/MODE: Successfully Withdrawn -->
        <div
          class="wallet-mode mode-withdrawn"
          v-else-if="mode === 'withdrawn'"
          key=" mode-withdrawn"
        >
          <div class="px-3 px-lg-4">
            <!-- Back Button -->
            <div class="pt-2 pb-3">
              <a
                href="#"
                class="card-link text-muted"
                v-on:click.stop.prevent="reset"
              >
                <svg
                  width="7"
                  height="13"
                  viewBox="0 0 7 13"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6.74372 11.4153C7.08543 11.7779 7.08543 12.3659 6.74372 12.7285C6.40201 13.0911 5.84799 13.0911 5.50628 12.7285L0.256283 7.15709C-0.0749738 6.80555 -0.0865638 6.23951 0.229991 5.87303L5.04249 0.301606C5.36903 -0.0764332 5.92253 -0.101971 6.27876 0.244565C6.63499 0.591101 6.65905 1.17848 6.33251 1.55652L2.08612 6.47256L6.74372 11.4153Z"
                    fill="#C3C6D1"
                  />
                </svg>
                Back
              </a>
            </div>
            <!-- Big green checkmark -->
            <circular-checkmark class="mb-4" success></circular-checkmark>

            <!-- Invoice amount + description -->
            <div class="text-center mb-2">
              <span class="d-block mb-2">
                Successfully withdrawn
                <b>
                  {{ withdraw.amount | unit | localize }}
                  {{ unit | formatUnit }}
                </b>
              </span>
              <small class="text-muted d-block">Transaction ID</small>
            </div>
            <!-- Copy Address Input Field -->
            <input-copy size="sm" :value="withdraw.txHash"></input-copy>
          </div>
        </div>

        <!-- SCREEN/MODE: Show Deposit Address -->
        <div
          class="wallet-mode mode-deposit"
          v-else-if="this.mode === 'deposit'"
          key="mode-deposit"
        >
          <div class="px-3 px-lg-4">
            <!-- Back Button -->
            <div class="pt-2 pb-3">
              <a
                href="#"
                class="card-link text-muted"
                v-on:click.stop.prevent="reset"
              >
                <svg
                  width="7"
                  height="13"
                  viewBox="0 0 7 13"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6.74372 11.4153C7.08543 11.7779 7.08543 12.3659 6.74372 12.7285C6.40201 13.0911 5.84799 13.0911 5.50628 12.7285L0.256283 7.15709C-0.0749738 6.80555 -0.0865638 6.23951 0.229991 5.87303L5.04249 0.301606C5.36903 -0.0764332 5.92253 -0.101971 6.27876 0.244565C6.63499 0.591101 6.65905 1.17848 6.33251 1.55652L2.08612 6.47256L6.74372 11.4153Z"
                    fill="#C3C6D1"
                  />
                </svg>
                Back
              </a>
            </div>
            <p class="text-center text-muted mb-3">
              <span>
                Send
                <b>only Bitcoin</b> to this address
              </span>
            </p>

            <!-- Deposit Address QR Code -->
            <qr-code
              class="mb-3 mx-auto"
              :value="depositAddress"
              :size="190"
              showLogo
            ></qr-code>

            <!-- Copy Address Input Field -->
            <input-copy
              size="sm"
              :value="depositAddress"
              class="mb-4 mt-1"
            ></input-copy>
          </div>
        </div>
      </transition>
    </div>

    <!-- Error message -->
    <div class="wallet-error d-block w-100 mb-2">
      <small class="text-danger error px-3 px-lg-4">{{ error }}</small>
    </div>

    <!-- Wallet buttons -->
    <div class="wallet-buttons">
      <b-button-group class="w-100" v-if="mode === 'transactions'">
        <b-button
          class="w-50"
          variant="primary"
          style="border-radius: 0; border-bottom-left-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
          @click="changeMode('withdraw')"
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 19 19"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="mr-1"
          >
            <path
              d="M7.06802 4.71946C6.76099 4.71224 6.50825 4.96178 6.50627 5.27413C6.50435 5.57592 6.7539 5.82865 7.05534 5.83022L12.7162 5.86616L4.81508 13.3568C4.59632 13.5735 4.59981 14.1376 4.81615 14.3568C5.03249 14.5759 5.59723 14.572 5.81634 14.3556L13.4988 6.6587L13.4576 12.3143C13.4609 12.6214 13.7108 12.8745 14.0122 12.876C14.3246 12.878 14.5777 12.6281 14.574 12.3214L14.6184 5.32036C14.6257 5.01333 14.3761 4.76059 14.0694 4.76427L7.06802 4.71946Z"
              fill="#FFFFFF"
            /></svg
          >Withdraw
        </b-button>
        <b-button
          class="w-50"
          variant="success"
          style="border-radius: 0; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
          @click="changeMode('deposit')"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="mr-1"
          >
            <path
              d="M13.5944 6.04611C13.6001 5.73904 13.3493 5.48755 13.0369 5.48712C12.7351 5.4867 12.4836 5.7375 12.4836 6.03895L12.4758 11.6999L4.94598 3.83615C4.72819 3.61848 4.16402 3.62477 3.94599 3.8422C3.72796 4.05963 3.73466 4.62433 3.95209 4.84236L11.6871 12.4864L6.03143 12.4733C5.72435 12.4782 5.47251 12.7293 5.47244 13.0308C5.47201 13.3431 5.72317 13.595 6.0299 13.5898L13.031 13.5994C13.3381 13.6051 13.5896 13.3543 13.5844 13.0476L13.5944 6.04611Z"
              fill="#FFFFFF"
            /></svg
          >Deposit
        </b-button>
      </b-button-group>
      <b-button
        class="w-100"
        variant="primary"
        style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
        @click="changeMode('review-withdraw')"
        v-else-if="mode === 'withdraw'"
        :disabled="
          !!error || !withdraw.amount || !withdraw.address || withdraw.isTyping
        "
        >Review Withdrawal</b-button
      >
      <b-button
        class="w-100"
        variant="primary"
        style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
        @click="withdrawBtc"
        :disabled="withdraw.isWithdrawing || !!error"
        v-else-if="mode === 'review-withdraw'"
      >
        {{
          this.withdraw.isWithdrawing ? "Withdrawing..." : "Confirm Withdrawal"
        }}
      </b-button>
      <b-button
        class="w-100"
        variant="success"
        style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
        :disabled="withdraw.isWithdrawing"
        v-else-if="mode === 'withdrawn'"
        :href="getTxExplorerUrl(withdraw.txHash)"
        target="_blank"
        @click="openTxInExplorer"
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 19 19"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          class="mr-1"
        >
          <path
            d="M7.06802 4.71946C6.76099 4.71224 6.50825 4.96178 6.50627 5.27413C6.50435 5.57592 6.7539 5.82865 7.05534 5.83022L12.7162 5.86616L4.81508 13.3568C4.59632 13.5735 4.59981 14.1376 4.81615 14.3568C5.03249 14.5759 5.59723 14.572 5.81634 14.3556L13.4988 6.6587L13.4576 12.3143C13.4609 12.6214 13.7108 12.8745 14.0122 12.876C14.3246 12.878 14.5777 12.6281 14.574 12.3214L14.6184 5.32036C14.6257 5.01333 14.3761 4.76059 14.0694 4.76427L7.06802 4.71946Z"
            fill="#FFFFFF"
          /></svg
        >View Transaction
      </b-button>
    </div>
  </card-widget>
</template>

<script>
import moment from "moment";
import { mapState, mapGetters } from "vuex";

import { satsToBtc, btcToSats } from "@/helpers/units.js";
import API from "@/helpers/api";

import CountUp from "@/components/Utility/CountUp";
import CardWidget from "@/components/CardWidget";
import InputCopy from "@/components/Utility/InputCopy";
import QrCode from "@/components/Utility/QrCode.vue";
import CircularCheckmark from "@/components/Utility/CircularCheckmark.vue";
import SatsBtcSwitch from "@/components/Utility/SatsBtcSwitch";
import FeeSelector from "@/components/Utility/FeeSelector";

export default {
  data() {
    return {
      //balance: 162500, //net user's balance in sats
      mode: "transactions", //transactions (default mode), deposit, withdraw, review-withdraw, withdrawn
      withdraw: {
        amountInput: "",
        amount: "", //withdrawal amount
        address: "", //withdrawal address
        sweep: false, //sweep = send all funds?
        feesTimeout: null, //window.setTimeout for fee fetching
        isTyping: false, //to disable button when the user changes amount/address
        isWithdrawing: false, //awaiting api response for withdrawal request?
        txHash: "", //tx hash of withdrawal tx,
        selectedFee: { type: "normal", satPerByte: 0 } //selected withdrawal fee
      },
      loading: false, //overall state of the wallet, used to toggle progress bar on top of the card,
      error: "" //used to show any error occured, eg. invalid amount, enter more than 0 sats, invoice expired, etc
    };
  },
  props: {},
  computed: {
    ...mapState({
      lightningSyncPercent: state => state.lightning.percent,
      walletBalance: state => {
        //skip if still loading
        if (state.bitcoin.balance.total === -1) {
          return -1;
        }
        if (state.system.unit === "btc") {
          return satsToBtc(state.bitcoin.balance.total);
        }
        return state.bitcoin.balance.total;
      },
      walletBalanceInSats: state => state.bitcoin.balance.total,
      confirmedBtcBalance: state => state.bitcoin.balance.confirmed,
      depositAddress: state => state.bitcoin.depositAddress,
      fees: state => state.bitcoin.fees,
      unit: state => state.system.unit,
      chain: state => state.bitcoin.chain,
      localExplorerTxUrl: state => {
        // Check for mempool app
        const mempool = state.apps.installed.find(({id}) => id === 'mempool');
        if (mempool) {
          return window.location.origin.indexOf(".onion") > 0 ? `http://${mempool.hiddenService}${mempool.path}/tx/` : `http://${window.location.hostname}:${mempool.port}${mempool.path}/tx/`;
        }

        // Check for btc-rpc-explorer app
        const btcRpcExplorer = state.apps.installed.find(({id}) => id === 'btc-rpc-explorer');
        if (btcRpcExplorer) {
          return window.location.origin.indexOf(".onion") > 0 ? `http://${btcRpcExplorer.hiddenService}${btcRpcExplorer.path}/tx/` : `http://${window.location.hostname}:${btcRpcExplorer.port}${btcRpcExplorer.path}/tx/`;
        }

        // Else return empty string
        return "";
      }
    }),
    ...mapGetters({
      transactions: "bitcoin/transactions"
    }),
    projectedBalanceInSats() {
      if (this.withdraw.sweep) {
        return 0;
      }

      if (this.withdraw.selectedFee.type !== "custom") {
        const remainingBalanceInSats =
          this.$store.state.bitcoin.balance.total -
          this.withdraw.amount -
          this.fees[this.withdraw.selectedFee.type].total;
        return parseInt(remainingBalanceInSats, 10);
      } else {
        const remainingBalanceInSats =
          this.$store.state.bitcoin.balance.total -
          this.withdraw.amount -
          (parseInt(this.fees.fast.total, 10) /
            parseInt(this.fees.fast.perByte, 10)) *
            parseInt(this.withdraw.selectedFee.satPerByte, 10);
        return parseInt(Math.round(remainingBalanceInSats), 10);
      }
    }
  },
  methods: {
    getTimeFromNow(timestamp) {
      return moment(timestamp).fromNow(); //used in the list of txs, eg "a few seconds ago"
    },
    getReadableTime(timestamp) {
      return moment(timestamp).format("MMMM D, h:mm:ss a"); //used in the list of txs, eg "March 08, 2020 3:03:12 pm"
    },
    getTxExplorerUrl(txHash) {
      if (this.localExplorerTxUrl) {
        return `${this.localExplorerTxUrl}${txHash}`;
      }
      else {
        if (window.location.origin.indexOf(".onion") > 0) {
          return this.chain === "test" ? `http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/testnet/tx/${txHash}` : `http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/tx/${txHash}`;
        }
        return this.chain === "test" ? `https://mempool.space/testnet/tx/${txHash}` : `https://mempool.space/tx/${txHash}`;
      }
    },
    openTxInExplorer(event) {
      if (!this.localExplorerTxUrl && !window.confirm('This will open your transaction details in a public explorer (mempool.space). Do you wish to continue?')) {
        event.preventDefault();
      }
    },
    async changeMode(mode) {
      //change between different modes/screens of the wallet from - transactions (default), withdraw, withdrawan, depsoit

      //on deposit mode, get new btc address
      if (mode === "deposit") {
        await this.$store.dispatch("bitcoin/getDepositAddress");
      }

      return (this.mode = mode);
    },
    reset() {
      //reset to default mode, clear any inputs/generated invoice, pasted invoice, etc - used by "Back" button

      //to do: refresh balance, txs

      //in case going back from review withdrawal to edit withdrwal
      if (this.mode === "review-withdraw") {
        // Clear any error
        this.error = "";
        this.mode = "withdraw";
        return;
      }

      //reset state
      this.withdraw = {
        amount: "",
        address: "",
        sweep: false,
        feesTimeout: null,
        isTyping: false, //to disable button when the user changes amount/address
        isWithdrawing: false,
        txHash: "",
        selectedFee: { type: "normal", satPerByte: 0 }
      };

      this.loading = false;
      this.error = "";
      this.mode = "transactions";
    },
    async fetchWithdrawalFees() {
      if (this.withdraw.feesTimeout) {
        clearTimeout(this.withdraw.feesTimeout);
      }
      this.withdraw.isTyping = true;

      this.withdraw.feesTimeout = setTimeout(async () => {
        this.loading = true;
        if (this.withdraw.amount && this.withdraw.address) {
          const params = {
            address: this.withdraw.address,
            confTarget: 0,
            sweep: this.withdraw.sweep
          };

          if (!this.withdraw.sweep) {
            params.amt = this.withdraw.amount;
          }

          await this.$store.dispatch("bitcoin/getFees", params);

          if (this.fees) {
            //show error if any
            if (
              this.fees[this.withdraw.selectedFee.type] &&
              this.fees[this.withdraw.selectedFee.type].error.code
            ) {
              this.error = this.fees[this.withdraw.selectedFee.type].error.text;
            } else {
              this.error = "";
            }
            // if (this.withdraw.sweep) {
            // this.estimateSweep();
            // }
          }
        }
        this.loading = false;
        this.withdraw.isTyping = false;
      }, 500);
    },
    selectWithdrawalFee(fee) {
      this.withdraw.selectedFee = fee;
    },
    async withdrawBtc() {
      this.loading = true;
      this.withdraw.isWithdrawing = true;

      const payload = {
        addr: this.withdraw.address,
        amt: this.withdraw.amount,
        satPerByte: parseInt(this.withdraw.selectedFee.satPerByte, 10),
        sendAll: this.withdraw.sweep
      };

      try {
        const res = await API.post(
          `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/transaction`,
          payload
        );
        const withdrawTx = res.data;
        this.withdraw.txHash = withdrawTx.txid;
        this.changeMode("withdrawn");

        //update
        this.$store.dispatch("bitcoin/getBalance");
        this.$store.dispatch("bitcoin/getTransactions");
      } catch (error) {
        this.error = error.response.data || "Error sending BTC";
      }
      this.loading = false;
      this.withdraw.isWithdrawing = false;
    }
  },
  watch: {
    "withdraw.amountInput": function(val) {
      if (this.unit === "sats") {
        this.withdraw.amount = Number(val);
      } else if (this.unit === "btc") {
        this.withdraw.amount = btcToSats(val);
      }
      this.fetchWithdrawalFees();
    },
    "withdraw.sweep": async function(val) {
      if (val) {
        if (this.unit === "sats") {
          this.withdraw.amountInput = String(this.confirmedBtcBalance);
        } else if (this.unit === "btc") {
          this.withdraw.amountInput = String(
            satsToBtc(this.confirmedBtcBalance)
          );
        }
      } else {
        this.fetchWithdrawalFees();
      }
    },
    unit: function(val) {
      if (val === "sats") {
        this.withdraw.amount = Number(this.withdraw.amountInput);
      } else if (val === "btc") {
        this.withdraw.amount = btcToSats(this.withdraw.amountInput);
      }
      this.fetchWithdrawalFees();
    }
  },
  async created() {
    this.$store.dispatch("bitcoin/getStatus");

    // to fetch any installed explorers
    // and their hidden services
    this.$store.dispatch("apps/getInstalledApps");
  },
  components: {
    CardWidget,
    QrCode,
    CountUp,
    InputCopy,
    CircularCheckmark,
    SatsBtcSwitch,
    FeeSelector
  }
};
</script>

<style lang="scss" scoped>
.transaction-description {
  flex: 1;
  min-width: 0;
  .transaction-description-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 10px;
  }
}

// Transitions between mode/screen changes
.lightning-mode-change-enter-active,
.lightning-mode-change-leave-active {
  transition: transform 0.3s, opacity 0.3s linear;
}
.lightning-mode-change-enter {
  transform: translate3d(20px, 0, 0);
  opacity: 0;
}
.lightning-mode-change-enter-to {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
.lightning-mode-change-leave {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}
.lightning-mode-change-leave-to {
  transform: translate3d(-20px, 0, 0);
  opacity: 0;
}

//slide up transition with fade
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.8s, opacity 0.8s ease;
}
.slide-up-enter,
.slide-up-leave-to {
  transform: translate3d(0, 10px, 0);
  opacity: 0;
}
</style>
