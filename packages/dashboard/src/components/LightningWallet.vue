<template>
  <card-widget
    header="Lightning Wallet"
    :status="{ text: lightningSyncPercent < 100 ? 'Synchronizing' : 'Active', variant: 'success', blink: false }"
    :sub-title="unit | formatUnit"
    icon="icon-app-lightning.svg"
    :loading="
      loading ||
        (transactions.length > 0 && transactions[0]['type'] === 'loading') || lightningSyncPercent < 100
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
      <span class="loading-placeholder loading-placeholder-lg" style="width: 140px;" v-else></span>
    </template>
    <div class="wallet-content">
      <!-- transition switching between different modes -->
      <transition name="lightning-mode-change" mode="out-in" tag="div">
        <!-- Default tx mode -->
        <div
          v-if="mode === 'transactions'"
          key="mode-transactions"
          class="mode-transactions wallet-mode"
        >
          <!-- List of transactions -->

          <!-- No transactions -->
          <div
            class="d-flex flex-column justify-content-center px-3 px-lg-4 zero-wallet-transactions-container"
            v-if="transactions.length === 0"
          >
            <!-- Piggy bank icon -->
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
                d="M76.6653 27.1865C76.6157 27.0954 76.5438 27.0197 76.4569 26.967C76.37 26.9144 76.2712 26.8866 76.1708 26.8866H68.7232L69.9718 16.9612C69.9852 16.8283 69.9552 16.6947 69.8868 16.5817C69.8183 16.4687 69.7152 16.383 69.5942 16.3384C69.4732 16.2938 69.3413 16.2928 69.2197 16.3356C69.0981 16.3785 68.9939 16.4627 68.9239 16.5746L59.8669 33.0831C59.814 33.1727 59.7849 33.2754 59.7828 33.3805C59.7807 33.4858 59.8056 33.5897 59.855 33.6814C59.9043 33.7732 59.9763 33.8498 60.0635 33.903C60.1507 33.9562 60.25 33.9843 60.3512 33.9843H67.6874L66.6979 43.9247C66.6882 44.0571 66.7213 44.1891 66.792 44.2996C66.8626 44.4102 66.9668 44.4929 67.0879 44.5347C67.209 44.5767 67.3401 44.5751 67.4603 44.5305C67.5805 44.4859 67.6829 44.4007 67.7512 44.2887L76.6586 27.7819C76.7101 27.6922 76.738 27.5898 76.7392 27.4852C76.7404 27.3806 76.7149 27.2775 76.6653 27.1865Z"
                fill="#EDEEF1"
              />
            </svg>
            <small class="align-self-center mt-3 text-muted">No transactions</small>
          </div>

          <!-- Actual Transactions -->
          <div class="wallet-transactions-container" v-else>
            <transition-group name="slide-up" class="list-group pb-2 transactions">
              <b-list-group-item
                v-for="tx in transactions"
                :key="tx.paymentRequest || tx.paymentPreImage"
                class="flex-column align-items-start px-3 px-lg-4"
                href="#"
                @click.prevent="showTransactionInfo(tx)"
              >
                <!-- Loading Transactions Placeholder -->
                <div class="d-flex w-100 justify-content-between" v-if="tx.type === 'loading'">
                  <div class="w-50">
                    <span class="loading-placeholder"></span>

                    <!-- Timestamp of tx -->
                    <span class="loading-placeholder loading-placeholder-sm" style="width: 40%"></span>
                  </div>

                  <div class="w-25 text-right">
                    <span class="loading-placeholder"></span>
                    <span class="loading-placeholder loading-placeholder-sm" style="width: 30%"></span>
                  </div>
                </div>

                <!-- Transaction -->
                <div class="d-flex w-100 justify-content-between" v-else>
                  <div class="transaction-description">
                    <h6 class="mb-0 font-weight-normal transaction-description-text">
                      <!-- Incoming tx icon -->
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        v-if="tx.type === 'incoming'"
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
                        v-else-if="tx.type === 'outgoing'"
                      >
                        <path
                          d="M7.06802 4.71946C6.76099 4.71224 6.50825 4.96178 6.50627 5.27413C6.50435 5.57592 6.7539 5.82865 7.05534 5.83022L12.7162 5.86616L4.81508 13.3568C4.59632 13.5735 4.59981 14.1376 4.81615 14.3568C5.03249 14.5759 5.59723 14.572 5.81634 14.3556L13.4988 6.6587L13.4576 12.3143C13.4609 12.6214 13.7108 12.8745 14.0122 12.876C14.3246 12.878 14.5777 12.6281 14.574 12.3214L14.6184 5.32036C14.6257 5.01333 14.3761 4.76059 14.0694 4.76427L7.06802 4.71946Z"
                          fill="#5351FB"
                        />
                      </svg>

                      <!-- Expired invoice icon -->
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        v-else-if="tx.type === 'expired'"
                      >
                        <path
                          fill-rule="evenodd"
                          clip-rule="evenodd"
                          d="M13.6003 4.44197C13.3562 4.19789 12.9605 4.19789 12.7164 4.44197L9.02116 8.1372L5.32596 4.442C5.08188 4.19792 4.68615 4.19792 4.44207 4.442C4.198 4.68607 4.198 5.0818 4.44207 5.32588L8.13728 9.02109L4.44185 12.7165C4.19777 12.9606 4.19777 13.3563 4.44185 13.6004C4.68592 13.8445 5.08165 13.8445 5.32573 13.6004L9.02116 9.90497L12.7166 13.6004C12.9607 13.8445 13.3564 13.8445 13.6005 13.6004C13.8446 13.3563 13.8446 12.9606 13.6005 12.7165L9.90505 9.02109L13.6003 5.32585C13.8444 5.08178 13.8444 4.68605 13.6003 4.44197Z"
                          fill="#F46E6E"
                        />
                      </svg>

                      <!-- Pending invoice icon -->
                      <svg
                        class="icon-clock"
                        viewBox="0 0 40 40"
                        v-else-if="tx.type === 'pending'"
                      >
                        <circle cx="20" cy="20" r="18" />
                        <line x1="0" y1="0" x2="8" y2="0" class="hour" />
                        <line x1="0" y1="0" x2="12" y2="0" class="minute" />
                      </svg>

                      <!-- Invoice description -->
                      <span
                        style="margin-left: 6px;"
                        :title="tx.description"
                        v-if="tx.description"
                      >{{ tx.description }}</span>

                      <!-- If no description -->
                      <span style="margin-left: 6px;" v-else>Payment</span>
                    </h6>

                    <!-- Timestamp of tx -->
                    <small
                      class="text-muted mt-0 tx-timestamp"
                      style="margin-left: 25px;"
                      v-b-tooltip.hover.right
                      :title="getReadableTime(tx.timestamp)"
                      v-if="tx.type === 'outgoing' || tx.type === 'incoming'"
                    >{{ getTimeFromNow(tx.timestamp) }}</small>

                    <!-- if invoice isn't settled -->
                    <small
                      class="text-muted mt-0 tx-timestamp"
                      style="margin-left: 21px;"
                      :title="
                        `Invoice expires on ${getReadableTime(tx.expiresOn)}`
                      "
                      v-else-if="tx.type === 'pending'"
                    >Unpaid invoice</small>

                    <!-- If invoice expired -->
                    <small
                      class="text-muted mt-0 tx-timestamp"
                      style="margin-left: 25px;"
                      :title="getReadableTime(tx.expiresOn)"
                      v-else-if="tx.type === 'expired'"
                    >Invoice expired {{ getTimeFromNow(tx.expiresOn) }}</small>
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

        <!-- SCREEN/MODE: Paste Invoice Screen -->
        <div class="px-3 px-lg-4 mode-send wallet-mode" v-else-if="mode === 'send'" key="mode-send">
          <!-- Back Button -->
          <div class="pb-3">
            <a href="#" class="card-link text-muted" v-on:click.stop.prevent="reset">
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

          <label class="sr-onlsy" for="input-sats">Paste Invoice</label>
          <b-input
            id="input-sats"
            class="mb-4 neu-input"
            type="text"
            size="lg"
            min="1"
            v-model="send.paymentRequest"
            autofocus
            @input="fetchInvoiceDetails"
            :disabled="send.isSending"
          ></b-input>

          <!-- Invoice amount + description -->
          <div v-if="send.isValidInvoice && send.amount">
            <div class="d-flex justify-content-between mb-3 align-items-center">
              <div>
                <small class="d-block text-muted mb-1">Paying</small>
                <h4 class="d-block mb-0">{{ send.amount | unit | localize }}</h4>
                <small class="d-block text-muted">
                  {{
                  unit | formatUnit
                  }}
                </small>
              </div>
              <small class="d-block text-muted">~ {{ send.amount | satsToUSD }}</small>
            </div>

            <div v-if="send.description">
              <small class="d-block text-muted mb-1">For</small>
              <span>{{ send.description }}</span>
            </div>
          </div>
        </div>

        <!-- SCREEN/MODE: Successfully paid invoice -->
        <div class="px-3 px-lg-4 mode-sent wallet-mode" v-else-if="mode === 'sent'" key="mode-sent">
          <!-- Back Button -->
          <div class="pb-3">
            <a href="#" class="card-link text-muted" v-on:click.stop.prevent="reset">
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
          <circular-checkmark class="mb-4 mt-4" success></circular-checkmark>

          <!-- Invoice amount + description -->
          <p class="text-center mb-4 pb-1">
            Paid
            <b>{{ send.amount | unit | localize }}</b>
            {{ unit | formatUnit }}
            <span v-if="send.description">
              for
              <b>{{ send.description }}</b>
            </span>
          </p>
        </div>

        <!-- SCREEN/MODE: Create Invoice (Receive) -->
        <div
          class="px-3 px-lg-4 mode-receive wallet-mode"
          v-else-if="mode === 'receive'"
          key="mode-receive"
        >
          <!-- Back Button -->
          <div class="pb-3">
            <a href="#" class="card-link text-muted" v-on:click.stop.prevent="reset">
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

          <label class="sr-onlsy" for="input-sats">Amount</label>
          <div class="mb-2">
            <b-input-group class="neu-input-group">
              <b-input
                id="input-sats"
                class="neu-input"
                type="text"
                size="lg"
                autofocus
                v-model.number="receive.amountInput"
                :disabled="receive.isGeneratingInvoice"
                style="padding-right: 82px"
              ></b-input>
              <b-input-group-append class="neu-input-group-append">
                <sats-btc-switch class="align-self-center" size="sm"></sats-btc-switch>
              </b-input-group-append>
            </b-input-group>
            <small
              class="text-muted mt-2 d-block text-right mb-0"
              :style="{ opacity: receive.amount > 0 ? 1 : 0 }"
            >~ {{ receive.amount | satsToUSD }}</small>
          </div>

          <label class="sr-onlsy" for="input-description">
            Description
            <small class="text-muted">(optional)</small>
          </label>
          <b-input
            id="input-description"
            class="mb-4 neu-input"
            size="lg"
            v-model="receive.description"
            :disabled="receive.isGeneratingInvoice"
          ></b-input>
        </div>

        <!-- SCREEN/MODE: Show Generated Invoice -->
        <div
          class="px-3 px-lg-4 pb-2 mode-invoice wallet-mode"
          v-else-if="this.mode === 'invoice'"
          key="mode-invoice"
        >
          <!-- Back Button -->
          <div class="pb-3">
            <a href="#" class="card-link text-muted" v-on:click.stop.prevent="reset">
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

          <p class="text-center text-muted mb-2">
            <!-- If still generating invoice, show blinking loading text -->
            <span class="blink" v-if="receive.isGeneratingInvoice">Generating Invoice</span>

            <!-- Invoice amount + description -->
            <span v-else>
              Invoice of
              <!-- {{ receive.amount | unit | localize}} -->
              <b>
                {{ receive.amount | unit | localize }}
                {{ unit | formatUnit }}
              </b>
              {{ receive.description ? "for" : null }}
              <b>{{ receive.description }}</b>
            </span>
          </p>

          <!-- QR Code -->
          <qr-code class="mb-3 mx-auto" :showLogo="!receive.isGeneratingInvoice" :value="receive.invoiceQR"></qr-code>

          <!-- Copy Invoice Input Field -->
          <transition name="slide-up" appear>
            <div class v-show="!receive.isGeneratingInvoice">
              <input-copy size="sm" :value="receive.invoiceQR" class="mb-2"></input-copy>
              <small class="text-center d-block text-muted">
                This invoice will expire
                {{ getTimeFromNow(receive.expiresOn) }}
              </small>
            </div>
          </transition>
        </div>

        <!-- SCREEN/MODE: Received (invoice settled) -->
        <div
          class="px-3 px-lg-4 mode-sent wallet-mode"
          v-else-if="mode === 'received'"
          key="mode-sent"
        >
          <!-- Back Button -->
          <div class="pb-3">
            <a href="#" class="card-link text-muted" v-on:click.stop.prevent="reset">
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
          <circular-checkmark class="mb-4 mt-4" success></circular-checkmark>

          <!-- Invoice amount + description -->
          <p class="text-center mb-4 pb-1">
            Received
            <b>{{ receive.amount | unit | localize }} {{ unit | formatUnit }}</b>
            <span v-if="receive.description">
              for
              <b>{{ receive.description }}</b>
            </span>
            <br />
            <small class="text-muted">{{ getReadableTime(receive.timestamp) }}</small>
          </p>
        </div>

        <!-- SCREEN/MODE: payment info -->
        <div
          class="px-3 px-lg-4 mode-payment-success wallet-mode"
          v-else-if="mode === 'payment-success'"
          key="payment-success"
        >
          <!-- Back Button -->
          <div class="pb-3">
            <a href="#" class="card-link text-muted" v-on:click.stop.prevent="reset">
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

          <circular-checkmark class="mb-4" success></circular-checkmark>

          <!-- Payment amount + description -->
          <p class="text-center mb-2">
            Paid
            <b>
              {{ paymentInfo.amount | unit | localize }}
              {{ unit | formatUnit }}
            </b>
            <span v-if="paymentInfo.description">
              for
              <b>{{ paymentInfo.description }}</b>
            </span>
          </p>
          <div class="pt-2 mb-3">
            <div class="d-flex justify-content-between">
              <small class="text-muted">{{ getReadableTime(paymentInfo.timestamp) }}</small>
              <small class="text-muted">
                Fee:
                {{ paymentInfo.fee | unit | localize }} {{ unit | formatUnit }}
              </small>
            </div>
            <div class="pt-3 d-block pb-2">
              <input-copy size="sm" :value="paymentInfo.paymentPreImage"></input-copy>
              <small class="text-center text-muted d-block mt-2">Payment proof (preimage)</small>
            </div>
          </div>
        </div>

        <!-- SCREEN/MODE: invoice expired -->
        <div
          class="px-3 px-lg-4 mode-invoice-expired wallet-mode"
          v-else-if="this.mode === 'invoice-expired'"
          key="mode-invoice-info"
        >
          <!-- Back Button -->
          <div class="pb-3">
            <a href="#" class="card-link text-muted" v-on:click.stop.prevent="reset">
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
          <!-- Big red checkmark -->
          <circular-checkmark class="mb-4 mt-4" danger></circular-checkmark>

          <!-- Invoice amount + description -->
          <p class="text-center mb-4 pb-1">
            This invoice was not paid
            <br />
            <small class="text-muted">Expired on {{ getReadableTime(expiredInvoice.expiresOn) }}</small>
          </p>
        </div>
      </transition>
    </div>

    <!-- Error message -->
    <div class="wallet-error d-block w-100 mb-2">
      <small class="text-danger error px-3 px-lg-4">{{ error }}</small>
    </div>

    <!-- Wallet buttons -->
    <div class="wallet-buttons">
      <!-- Buttons: Transactions (default mode) -->
      <b-button-group class="w-100" v-if="this.mode === 'transactions'">
        <b-button
          class="w-50"
          variant="primary"
          style="border-radius: 0; border-bottom-left-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
          @click="changeMode('send')"
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
            />
          </svg>Send
        </b-button>
        <b-button
          class="w-50"
          variant="success"
          style="border-radius: 0; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
          @click="changeMode('receive')"
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
            />
          </svg>Receive
        </b-button>
      </b-button-group>

      <b-button
        class="w-100"
        variant="success"
        style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
        @click="changeMode('receive')"
        v-else-if="this.mode === 'transactions' && walletBalance === 0"
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
          />
        </svg>Receive
      </b-button>

      <!-- Button: Send (paste invoice send) -->
      <b-button
        class="w-100"
        variant="primary"
        style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
        @click="sendSats"
        v-else-if="mode === 'send'"
        :disabled="
          !send.paymentRequest || !send.isValidInvoice || send.isSending
        "
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
          />
        </svg>
        {{ this.send.isSending ? "Sending..." : "Send" }}
      </b-button>

      <!-- Button: Create Invoice (receive mode) -->
      <b-button
        class="w-100"
        variant="success"
        style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
        @click="createInvoice"
        v-else-if="mode === 'receive'"
        :disabled="!receive.amount || receive.amount <= 0"
      >Create Invoice</b-button>

      <!-- spacer if no button -->
      <span
        v-else
        class="d-block w-100"
        style="border-radius: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; padding-top: 1rem; padding-bottom: 1rem;"
      ></span>
    </div>
  </card-widget>
</template>

<script>
import moment from "moment";

import { mapState } from "vuex";

import { satsToBtc, btcToSats } from "@/helpers/units.js";
import API from "@/helpers/api";

import CountUp from "@/components/Utility/CountUp";
import CardWidget from "@/components/CardWidget";
import InputCopy from "@/components/Utility/InputCopy";
import QrCode from "@/components/Utility/QrCode.vue";
import CircularCheckmark from "@/components/Utility/CircularCheckmark.vue";
import SatsBtcSwitch from "@/components/Utility/SatsBtcSwitch";

export default {
  data() {
    return {
      mode: "transactions", //transactions (default mode), receive (create invoice), invoice, send, sent, payment-success, invoice-info
      receive: {
        //receive info
        amount: null, //invoice amount
        description: "", //invoice description
        paymentRequest: "", //Bolt 11 invoice
        invoiceQR: "1", //used for "generating" animation, is ultimately equal to paymentRequest after animation
        isGeneratingInvoice: false, //used for transitions, animations, etc
        expiresOn: null, //invoice expiry date
        invoiceStatusPoller: null, // = setInterval used to fetch invoice settlement status
        invoiceStatusPollerInprogress: false //to lock to 1 poll at a time
      },
      send: {
        //send info
        paymentRequest: "", //Bolt 11 payment request/invoice entered by the user
        description: "", //invoice description
        amount: null, //invoice amount
        isValidInvoice: false, //check if invoice entered by user is a valid Bolt 11 invoice
        isSending: false, //used for transition while tx is being broadcasted,
        paymentPreImage: "" //proof of payment
      },
      paymentInfo: {
        //outgoing payment info
        amount: null, // payment amount
        description: "", //payment memo or description
        timestamp: null, //time of settlement
        fee: null, //routing fee of payment
        paymentRequest: "", //original payment request
        paymentPreImage: "" //proof of payment
      },
      expiredInvoice: {
        //expired invoice info
        expiresOn: null //expiry date of the unpaid/expired invoice
      },
      loading: false, //overall state of the wallet. eg. used to toggle progress bar on top of the card,
      error: "" //used to show any error occured, eg. invalid amount, enter more than 0 sats, invoice expired, etc
    };
  },
  props: {},
  computed: {
    ...mapState({
      lightningSyncPercent: state => state.lightning.percent,
      transactions: state => state.lightning.transactions,
      walletBalance: state => {
        //skip if still loading
        if (state.lightning.balance.total === -1) {
          return -1;
        }
        if (state.system.unit === "btc") {
          return satsToBtc(state.lightning.balance.total);
        }
        return state.lightning.balance.total;
      },
      walletBalanceInSats: state => state.lightning.balance.total,
      unit: state => state.system.unit
    }),
    isLightningPage() {
      return this.$router.currentRoute.path === "/lightning";
    }
  },
  methods: {
    //used in the list of txs, eg "a few seconds ago"
    getTimeFromNow(timestamp) {
      return moment(timestamp).fromNow();
    },
    //used in the list of txs, eg "March 08, 2020 3:03:12 pm"
    getReadableTime(timestamp) {
      return moment(timestamp).format("MMMM D, h:mm:ss a");
    },
    //change between different modes/screens of the wallet from - transactions (default), receive (create invoice), invoice, send, sent
    changeMode(mode) {
      return (this.mode = mode);
    },
    reset() {
      //reset to default mode, clear any inputs/generated invoice, pasted invoice, etc - used by "Back" button

      //refresh data
      this.$store.dispatch("lightning/getTransactions");
      this.$store.dispatch("lightning/getChannels");

      //clear any intervals
      window.clearInterval(this.receive.invoiceStatusPoller);

      //reset state
      this.receive = {
        amount: null,
        amountInput: "",
        description: "",
        paymentRequest: "",
        invoiceQR: "1",
        isGeneratingInvoice: false,
        expiresOn: null,
        invoiceStatusPoller: null,
        invoiceStatusPollerInprogress: false
      };
      this.send = {
        paymentRequest: "",
        description: "",
        amount: null,
        isValidInvoice: false,
        isSending: false
      };
      this.paymentInfo = {
        amount: null,
        description: "",
        timestamp: null,
        fee: null,
        paymentRequest: ""
      };
      this.expiredInvoice = {
        expiresOn: null
      };
      this.loading = false;
      this.error = "";
      this.mode = "transactions";
    },
    async sendSats() {
      //broadcast tx
      if (!this.send.isValidInvoice) return; //check if the invoice user pasted is valid

      this.loading = true;
      this.send.isSending = true;
      this.error = "";

      const payload = {
        amt: 0, //because payment request already has amount info
        paymentRequest: this.send.paymentRequest
      };

      try {
        const res = await API.post(
          `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/lightning/payInvoice`,
          payload
        );
        if (res.data.paymentError) {
          return (this.error = res.data.paymentError);
        }
        this.mode = "sent";

        //refresh
        this.$store.dispatch("lightning/getTransactions");
        this.$store.dispatch("lightning/getChannels");
      } catch (error) {
        this.error = JSON.stringify(error.response)
          ? error.response.data
          : "Error sending payment";
      }

      this.loading = false;
      this.send.isSending = false;
    },
    async createInvoice() {
      //generate invoice to receive payment
      this.loading = true;
      this.receive.isGeneratingInvoice = true;
      this.mode = "invoice";
      this.error = "";

      //start animated QR invoice until real invoice is fetched from the node
      this.QRAnimation = window.setInterval(() => {
        this.receive.invoiceQR = `${this.receive.invoiceQR}2345`;
      }, 200);

      const payload = {
        amt: this.receive.amount,
        memo: this.receive.description
      };

      //cool QR animation for a while
      setTimeout(async () => {
        try {
          const res = await API.post(
            `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/lightning/addInvoice`,
            payload
          );
          this.receive.invoiceQR = this.receive.paymentRequest =
            res.data.paymentRequest;

          //TODO: find a cleaner way to make this dynamic as per backend's expiry setting. for now invoice expiries are 1 hr
          this.receive.expiresOn = moment().add(1, "hour");

          //refresh txs
          this.$store.dispatch("lightning/getTransactions");
        } catch (error) {
          this.mode = "receive";
          this.error = JSON.stringify(error.response)
            ? error.response.data
            : "Error creating invoice";
        }
        this.loading = false;
        this.receive.isGeneratingInvoice = false;
        window.clearInterval(this.QRAnimation);
      }, 2500);
    },
    async fetchInvoiceDetails() {
      //fetch invoice details as pasted by user in the "Send" mode/screen
      //if empty field, reset last fetched invoice
      if (!this.send.paymentRequest) {
        this.loading = false;
        this.send.description = "";
        this.send.isValidInvoice = false;
        this.send.amount = null;
        this.send.description = "";
        this.error = "";
        return;
      }

      this.send.description = "";
      this.send.isValidInvoice = false;
      this.send.amount = null;
      this.send.description = "";
      this.error = "";
      this.loading = true;

      const fetchedInvoice = await API.get(
        `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/lightning/invoice?paymentRequest=${this.send.paymentRequest}`
      );

      if (!fetchedInvoice) {
        this.send.isValidInvoice = false;
        this.error = "Invalid invoice";
        this.loading = false;
        return;
      }

      //check if invoice is expired
      const now = Math.floor(new Date().getTime());
      const invoiceExpiresOn =
        (Number(fetchedInvoice.timestamp) + Number(fetchedInvoice.expiry)) *
        1000;

      if (now > invoiceExpiresOn) {
        this.send.isValidInvoice = false;
        this.error = `Invoice expired ${moment(invoiceExpiresOn).fromNow()}`;
      } else {
        this.send.amount = Number(fetchedInvoice.numSatoshis);
        this.send.description = fetchedInvoice.description;
        this.send.isValidInvoice = true;
        this.error = "";
      }

      this.loading = false;
    },
    showTransactionInfo(tx) {
      if (!tx || tx.type === "loading") return; //eg. when tx is loading

      //if outgoing payment, show success
      if (tx.type === "outgoing") {
        this.paymentInfo = {
          amount: tx.amount,
          description: tx.description,
          timestamp: tx.timestamp,
          fee: tx.fee,
          paymentRequest: tx.paymentRequest,
          paymentPreImage: tx.paymentPreImage
        };
        return this.changeMode("payment-success");
      }

      //if pending, show generated invoice screen (receive, so it also triggers poller)
      if (tx.type === "pending") {
        this.receive.amount = tx.amount;
        this.receive.description = tx.description;
        this.receive.paymentRequest = tx.paymentRequest;
        this.receive.invoiceQR = tx.paymentRequest;
        this.receive.isGeneratingInvoice = false;
        this.receive.expiresOn = tx.expiresOn;
        return this.changeMode("invoice");
      }

      if (tx.type === "incoming") {
        this.receive.amount = tx.amount;
        this.receive.description = tx.description;
        this.receive.timestamp = tx.timestamp;
        return this.changeMode("received");
      }

      if (tx.type === "expired") {
        this.expiredInvoice.expiresOn = tx.expiresOn;
        this.changeMode("invoice-expired");
      }
    }
  },
  watch: {
    "receive.paymentRequest": function(paymentRequest) {
      window.clearInterval(this.receive.invoiceStatusPoller);

      //if payment request is generated, fetch invoices to check settlement status as long as the user is on the generated invoice mode
      if (paymentRequest) {
        this.receive.invoiceStatusPoller = window.setInterval(async () => {
          //if previous poll awaited then skip
          if (this.receive.invoiceStatusPollerInprogress) {
            return;
          }
          this.receive.invoiceStatusPollerInprogress = true;
          const invoices = await API.get(
            `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/lightning/invoices`
          );
          if (invoices && invoices.length) {
            //search for invoice
            const currentInvoice = invoices.filter(inv => {
              return inv.paymentRequest === this.receive.paymentRequest;
            })[0];

            if (currentInvoice && currentInvoice.settled) {
              this.changeMode("received");
              window.clearInterval(this.receive.invoiceStatusPoller);

              //refresh
              this.$store.dispatch("lightning/getChannels");
              this.$store.dispatch("lightning/getTransactions");
            }
          }
          this.receive.invoiceStatusPollerInprogress = false;
        }, 1000);
      }
    },
    "receive.amountInput": function(val) {
      if (this.unit === "sats") {
        this.receive.amount = Number(val);
      } else if (this.unit === "btc") {
        this.receive.amount = btcToSats(val);
      }
    },
    unit: function(val) {
      if (val === "sats") {
        this.receive.amount = Number(this.receive.amountInput);
      } else if (val === "btc") {
        this.receive.amount = btcToSats(this.receive.amountInput);
      }
    }
  },
  async created() {
    window.moment = moment;
    await this.$store.dispatch("lightning/getStatus");
  },
  beforeDestroy() {
    window.clearInterval(this.QRAnimation);
    window.clearInterval(this.receive.invoiceStatusPoller);
  },
  components: {
    CardWidget,
    CountUp,
    QrCode,
    InputCopy,
    CircularCheckmark,
    SatsBtcSwitch
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

// For "Generating Invoice" loading text
.blink {
  animation: blink 1.5s infinite ease;
}

@keyframes blink {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 0.6;
  }
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

//fade transition
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}
.fade-enter,
.fade-leave-to {
  opacity: 0;
}
</style>
