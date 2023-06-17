<template>
  <div>
    <div class="p-sm-2">
      <div class="my-3">
        <div>
          <h1>connect wallet</h1>
          <p>Connect your Bitcoin or Lightning wallet to your Umbrel</p>
        </div>
      </div>

      <b-row>
        <b-col cols="12" md="4" xl="3">
          <b-form-select
            :value="wallet"
            :options="options"
            @change="selectWallet"
            class="mb-4"
          ></b-form-select>
        </b-col>
      </b-row>

      <router-view :urls="urls" @showQrModal="showQrModal"></router-view>
    </div>

      <b-modal
        id="qr-modal"
        ref="qr-modal"
        hide-footer
        size="lg"
      >
        <div class="d-flex w-100 align-items-center justify-content-center">
          <qr-code
            :value="this.qrModalData.value"
            :size="this.qrModalData.size"
            class="qr-image mb-5"
            showLogo
          ></qr-code>
        </div>
      </b-modal>
    </div>
</template>

<script>
import { mapState } from "vuex";
import QrCode from "@/components/Utility/QrCode.vue";

export default {
  data() {
    return {
      options: [
        { value: null, text: "Select your wallet", disabled: true },
        { value: "bitboxapp", text: "BitBoxApp" },
        { value: "blockstream-green", text: "Blockstream Green (Android)" },
        { value: "bluewallet", text: "BlueWallet" },
        { value: "electrum-android", text: "Electrum Wallet (Android)" },
        { value: "electrum-desktop", text: "Electrum Wallet (Desktop)" },
        { value: "fully-noded", text: "Fully Noded (iOS)" },
        { value: "lily-wallet", text: "Lily Wallet" },
        { value: "nunchuk-desktop", text: "Nunchuk Wallet (Desktop)" },
        { value: "phoenix", text: "Phoenix Wallet" },
        { value: "samourai-wallet", text: "Samourai Wallet" },
        { value: "sparrow", text: "Sparrow" },
        { value: "specter-desktop", text: "Specter Desktop" },
        { value: "wasabi", text: "Wasabi" },
        { value: "zap-android", text: "Zap (Android)" },
        { value: "zap-desktop", text: "Zap (Desktop)" },
        { value: "zap-ios", text: "Zap (iOS)" },
        { value: "zeus", text: "Zeus" },
        {
          label: "Other",
          options: [
            { value: "bitcoin-core-p2p", text: "Bitcoin Core P2P" },
            { value: "bitcoin-core-rpc", text: "Bitcoin Core RPC" },
            { value: "electrum-server", text: "Electrum Server" },
            { value: "lndconnect-grpc-local", text: "lndconnect gRPC (Local)" },
            { value: "lndconnect-grpc-tor", text: "lndconnect gRPC (Tor)" },
            { value: "lndconnect-rest-local", text: "lndconnect REST (Local)" },
            { value: "lndconnect-rest-tor", text: "lndconnect REST (Tor)" }
          ]
        }
      ],
      qrModalData: {
        value: "",
        size: window.innerWidth < 600 ? window.innerWidth - 60 : 500
      },
    };
  },
  computed: {
    ...mapState({
      urls: state => {
        return {
          bitcoin: {
            p2p: state.bitcoin.p2p,
            electrum: state.bitcoin.electrum,
            rpc: state.bitcoin.rpc
          },
          lnd: state.lightning.lndConnectUrls,
        };
      },
    }),
    wallet() {
      return this.$route.meta.wallet || null;
    },
  },
  methods: {
    fetchConnectionDetails() {
      return Promise.all([
        this.$store.dispatch("lightning/getLndConnectUrls"),
        this.$store.dispatch("bitcoin/getP2PInfo"),
        this.$store.dispatch("bitcoin/getElectrumInfo"),
        this.$store.dispatch("bitcoin/getRpcInfo")
      ]);
    },
    selectWallet(wallet) {
      this.$router.push(`/connect/${wallet}`);
    },
    showQrModal(value) {
      this.qrModalData.value = value
      this.$refs["qr-modal"].show();
    }
  },
  created() {
    this.fetchConnectionDetails();
  },
  components: {
    QrCode
  },
};
</script>

<style lang="scss">
@media (min-width: 456px) {
  #qr-modal {
    .modal-dialog {
      max-width: 600px;
      margin: 1.75rem auto;
    }
  }
}
</style>
