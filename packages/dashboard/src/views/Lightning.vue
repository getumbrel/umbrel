<template>
  <div class="p-sm-2">
    <div class="my-3 pb-2">
      <div class="d-flex justify-content-between align-items-center">
        <div class="d-flex justify-content-start align-items-center">
          <img
            style="height: auto; width: 12vw; max-width: 100px"
            class="mr-2 mr-sm-3"
            src="@/assets/icon-app-lnd.svg"
          />
          <div>
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="4" cy="4" r="4" fill="#00CD98" />
            </svg>
            <small class="ml-1 text-success">{{ status }}</small>
            <h3 class="d-block font-weight-bold mb-1">Lightning Network</h3>
            <span class="d-block text-muted">
              {{
                this.lndVersion
                  ? `v${this.lndVersion.split(" commit")[0]}`
                  : "..."
              }}
            </span>
          </div>
        </div>
        <div>
          <b-dropdown
            variant="link"
            toggle-class="text-decoration-none p-0"
            no-caret
            right
          >
            <template v-slot:button-content>
              <svg
                width="18"
                height="4"
                viewBox="0 0 18 4"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fill-rule="evenodd"
                  clip-rule="evenodd"
                  d="M2 4C3.10457 4 4 3.10457 4 2C4 0.89543 3.10457 0 2 0C0.89543 0 0 0.89543 0 2C0 3.10457 0.89543 4 2 4Z"
                  fill="#6c757d"
                />
                <path
                  fill-rule="evenodd"
                  clip-rule="evenodd"
                  d="M9 4C10.1046 4 11 3.10457 11 2C11 0.89543 10.1046 0 9 0C7.89543 0 7 0.89543 7 2C7 3.10457 7.89543 4 9 4Z"
                  fill="#6c757d"
                />
                <path
                  fill-rule="evenodd"
                  clip-rule="evenodd"
                  d="M16 4C17.1046 4 18 3.10457 18 2C18 0.89543 17.1046 0 16 0C14.8954 0 14 0.89543 14 2C14 3.10457 14.8954 4 16 4Z"
                  fill="#6c757d"
                />
              </svg>
            </template>
            <b-dropdown-item href="#" v-b-modal.lightning-address-modal
              >Lightning Address</b-dropdown-item
            >
            <!-- <b-dropdown-divider /> -->
            <!-- <b-dropdown-item variant="danger" href="#" disabled>Stop LND</b-dropdown-item> -->
          </b-dropdown>

          <b-modal id="lightning-address-modal" size="lg" centered hide-footer>
            <template v-slot:modal-header="{ close }">
              <div
                class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100"
              >
                <h3 class="text-lowercase">Lightning Address</h3>
                <!-- Emulate built in modal header close button action -->
                <a
                  href="#"
                  class="align-self-center"
                  v-on:click.stop.prevent="close"
                >
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
            <div class="px-2 px-sm-3 pb-2 pb-sm-3">
              <div class="d-flex align-items-center">
                <!-- Pubkey QR Code -->
                <qr-code
                  :value="uris.length ? uris[0] : pubkey"
                  :size="180"
                  class="qr-image mx-auto"
                  showLogo
                ></qr-code>
                <div class="w-100 align-self-center ml-3 ml-sm-4">
                  <p>
                    Other Lightning nodes can open payment channels to your node
                    on the following address
                  </p>
                  <div v-if="uris.length">
                    <input-copy
                      class="mb-2"
                      size="sm"
                      v-for="uri in uris"
                      :value="uri"
                      :key="uri"
                    ></input-copy>
                  </div>
                  <span
                    class="loading-placeholder loading-placeholder-lg mt-1"
                    style="width: 100%;"
                    v-else
                  ></span>
                </div>
              </div>
            </div>
          </b-modal>
        </div>
      </div>
    </div>
    <b-row class="row-eq-height">
      <b-col col cols="12" md="6" xl="4">
        <lightning-wallet></lightning-wallet>
      </b-col>
      <b-col col cols="12" md="6" xl="8">
        <card-widget header="Payment Channels">
          <template v-slot:header-right>
            <b-button
              variant="outline-primary"
              size="sm"
              v-b-modal.open-channel-modal
              >+ Open Channel</b-button
            >
          </template>
          <template v-slot:menu>
            <b-dropdown-item
              href="#"
              @click.stop.prevent="downloadChannelBackup"
              >Download channel backup file</b-dropdown-item
            >
            <b-dropdown-divider></b-dropdown-divider>
            <b-dropdown-group>
              <div class="dropdown-group">
                <div class="d-flex w-100 justify-content-between">
                <div>
                  <span class="d-block">Automatic backups</span>
                  <small class="d-block">
                    <a
                      href="https://github.com/getumbrel/umbrel/blob/master/scripts/backup/README.md"
                      target="blank"
                    >Learn more</a>
                  </small>
                </div>
                <toggle-switch
                  class="align-self-center"
                  disabled
                  tooltip="Sorry, automatic backups cannot be disabled for now"
                ></toggle-switch>
              </div>
              <small v-if="backupStatus.status" class="d-block mt-2" style="opacity: 0.4">
                  Last backup
                <span v-if="backupStatus.status === 'failed'">failed</span>
                at {{ getReadableTime(backupStatus.timestamp) }}
              </small>
              </div>
            </b-dropdown-group>
          </template>
          <div class>
            <div class="px-3 px-lg-4">
              <b-row>
                <b-col col cols="6" xl="3">
                  <stat
                    title="Connections"
                    :value="numPeers"
                    suffix="Peers"
                    showNumericChange
                  ></stat>
                </b-col>
                <b-col col cols="6" xl="3">
                  <stat
                    title="Active Channels"
                    :value="numActiveChannels"
                    suffix="Channels"
                    showNumericChange
                  ></stat>
                </b-col>
                <b-col col cols="6" xl="3">
                  <stat
                    title="Max Send"
                    :value="maxSend | unit"
                    :suffix="unit | formatUnit"
                    :hasDecimals="unit === 'btc'"
                    abbreviateValue
                  ></stat>
                </b-col>
                <b-col col cols="6" xl="3">
                  <stat
                    title="Max Receive"
                    :value="maxReceive | unit"
                    :suffix="unit | formatUnit"
                    :hasDecimals="unit === 'btc'"
                    abbreviateValue
                  ></stat>
                </b-col>
              </b-row>
            </div>

            <b-modal
              id="open-channel-modal"
              ref="open-channel-modal"
              size="lg"
              centered
              hide-footer
            >
              <template v-slot:modal-header="{ close }">
                <div
                  class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100"
                >
                  <h2>open channel</h2>
                  <!-- Emulate built in modal header close button action -->
                  <a
                    href="#"
                    class="align-self-center"
                    v-on:click.stop.prevent="close"
                  >
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
              <div class="px-2 px-sm-3 py-2">
                <channel-open v-on:channelopen="onChannelOpen"></channel-open>
              </div>
            </b-modal>

            <!-- manage channel modal -->
            <b-modal
              id="manage-channel-modal"
              ref="manage-channel-modal"
              size="lg"
              centered
              hide-footer
            >
              <template v-slot:modal-header="{ close }">
                <div
                  class="px-2 px-sm-3 pt-2 d-flex justify-content-between w-100"
                >
                  <h2>channel details</h2>
                  <!-- Emulate built in modal header close button action -->
                  <a
                    href="#"
                    class="align-self-center"
                    v-on:click.stop.prevent="close"
                  >
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
              <div class="px-2 px-sm-3 py-2">
                <channel-manage
                  :channel="selectedChannel"
                  v-on:channelclose="onChannelClose"
                ></channel-manage>
              </div>
            </b-modal>

            <channel-list v-on:selectchannel="manageChannel"></channel-list>
          </div>
        </card-widget>
      </b-col>
    </b-row>
  </div>
</template>

<script>
import { mapState } from "vuex";
import moment from "moment";

import API from "@/helpers/api";

import CardWidget from "@/components/CardWidget";
import Stat from "@/components/Utility/Stat";
import LightningWallet from "@/components/LightningWallet";
import QrCode from "@/components/Utility/QrCode";
import InputCopy from "@/components/Utility/InputCopy";
import ToggleSwitch from "@/components/ToggleSwitch";
import ChannelList from "@/components/Channels/List";
import ChannelOpen from "@/components/Channels/Open";
import ChannelManage from "@/components/Channels/Manage";

export default {
  data() {
    return {
      status: "Running",
      selectedChannel: {}
    };
  },
  computed: {
    ...mapState({
      lndVersion: state => state.lightning.version,
      numActiveChannels: state => state.lightning.numActiveChannels,
      maxReceive: state => state.lightning.maxReceive,
      maxSend: state => state.lightning.maxSend,
      numPeers: state => state.lightning.numPeers,
      alias: state => state.lightning.alias,
      pubkey: state => state.lightning.pubkey,
      uris: state => state.lightning.uris,
      lndConnectUrls: state => state.lightning.lndConnectUrls,
      channels: state => state.lightning.channels,
      unit: state => state.system.unit,
      backupStatus: state => state.system.backupStatus,
    })
  },
  methods: {
    getReadableTime(timestamp) {
      return moment(timestamp).format("MMM D, h:mm:ss a");
    },
    async downloadChannelBackup() {
      await API.download(
        `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/util/download-channel-backup`,
        {},
        true,
        "my-umbrel-channels.backup"
      );
    },
    manageChannel(channel) {
      if (channel) {
        this.selectedChannel = channel;
        this.$refs["manage-channel-modal"].show();
      }
    },
    onChannelOpen() {
      //refresh channels, balance and txs
      this.fetchPageData();
      this.$refs["open-channel-modal"].hide();

      //refresh bitcoin balance and txs
      this.$store.dispatch("bitcoin/getBalance");
      this.$store.dispatch("bitcoin/getTransactions");
    },
    onChannelClose() {
      //refresh channels, balance and txs
      this.fetchPageData();
      this.$refs["manage-channel-modal"].hide();

      //refresh bitcoin balance and txs
      this.$store.dispatch("bitcoin/getBalance");
      this.$store.dispatch("bitcoin/getTransactions");
    },
    fetchPageData() {
      this.$store.dispatch("lightning/getLndPageData");
    }
  },
  created() {
    this.fetchPageData();
    this.$store.dispatch("lightning/getLndConnectUrls");
    this.$store.dispatch("system/getBackupStatus");
    this.interval = window.setInterval(this.fetchPageData, 10000);
  },
  beforeDestroy() {
    window.clearInterval(this.interval);
  },
  watch: {
    password: function() {
      this.isIncorrectPassword = false;
    }
  },
  components: {
    LightningWallet,
    CardWidget,
    Stat,
    QrCode,
    InputCopy,
    ToggleSwitch,
    ChannelList,
    ChannelOpen,
    ChannelManage
  }
};
</script>

<style lang="scss" scoped></style>
