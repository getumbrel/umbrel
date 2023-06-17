<template>
  <connection-details name="any other wallet that supports lndconnect gRPC on local network" requires="lnd">
    <div class="d-lg-flex align-items-center justify-content-center pb-3">
      <qr-code
        :value="urls.lnd.grpcLocal"
        :size="260"
        level="M"
        class="qr-image mx-auto mb-3 mb-lg-0"
        showLogo
        @click="$emit('showQrModal', urls.lnd.grpcLocal)"
        v-bind:style="{ cursor: 'pointer' }"
      ></qr-code>
      <div class="w-100 align-self-center ml-lg-3">
        <label class="mb-1 d-block"><small class="font-weight-bold">lndconnect URL</small></label>
        <input-copy class="my-1" :value="urls.lnd.grpcLocal"></input-copy>
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
