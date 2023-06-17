<template>
  <connection-details name="any other wallet that supports Bitcoin Core's RPC" requires="bitcoind">
    <div class="d-lg-flex align-items-center justify-content-center pb-3">
      <qr-code
        :value="urls.bitcoin.rpc.connectionString"
        :size="260"
        level="M"
        class="qr-image mx-auto mb-3 mb-lg-0"
        showLogo
        @click="$emit('showQrModal', urls.bitcoin.rpc.connectionString)"
        v-bind:style="{ cursor: 'pointer' }"
      ></qr-code>
      <div class="w-100 align-self-center ml-lg-3 connect-wallet-steps">
        <div class="connect-wallet-step">
          <label class="mb-1 d-block"><small class="ml-1 font-weight-bold">Bitcoin Core RPC Username</small></label>
          <input-copy class="my-1" :value="urls.bitcoin.rpc.rpcuser" auto-width></input-copy>
        </div>
        <div class="connect-wallet-step">
          <label class="mb-1 d-block"><small class="ml-1 font-weight-bold">Bitcoin Core RPC Password</small></label>
          <input-copy class="my-1" :value="urls.bitcoin.rpc.rpcpassword" auto-width></input-copy>
        </div>
        <div class="connect-wallet-step">
          <label class="mb-1 d-block"><small class="ml-1 font-weight-bold">Bitcoin Core RPC Address (Host)</small></label>
          <input-copy class="my-1" :value="urls.bitcoin.rpc.address" auto-width></input-copy>
        </div>
        <div class="connect-wallet-step">
          <label class="mb-1 d-block"><small class="ml-1 font-weight-bold">Bitcoin Core RPC Port</small></label>
          <input-copy class="my-1" :value="urls.bitcoin.rpc.port" auto-width></input-copy>
        </div>
      </div>
    </div>
  </connection-details>
</template>

<script>
import ConnectionDetails from "@/components/ConnectWallet/ConnectionDetails";
import InputCopy from "@/components/Utility/InputCopy";
import QrCode from "@/components/Utility/QrCode";

export default {
  props: {
    urls: Object
  },
  components: {
    ConnectionDetails,
    InputCopy,
    QrCode
  }
};
</script>
