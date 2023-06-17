<template>
  <connection-details name="Fully Noded (iOS)" requires="bitcoind">
    <step-list>
      <step>
        Open the Fully Noded app on your iPhone.
      </step>
      <step>
        Go to <span class="font-weight-bold">Settings > Node Manager > +</span>.
      </step>
      <step>
        Scan this QR Code (click to enlarge)
        <qr-code
          :value="urls.bitcoin.rpc.connectionString"
          :size="200"
          class="qr-image mt-2"
          showLogo
          @click="$emit('showQrModal', urls.bitcoin.rpc.connectionString)"
          v-bind:style="{ cursor: 'pointer' }"
        ></qr-code>
        <hr/>
        <p class="text-muted">Or manually enter the following details</p>
        <ul class="connect-wallet-substeps">
          <li class="connect-wallet-substep">
            In the <span class="font-weight-bold">"RPC Username"</span>, enter
            <input-copy class="my-1" :value="urls.bitcoin.rpc.rpcuser" auto-width ></input-copy>
          </li>
          <li class="connect-wallet-substep">
            In the <span class="font-weight-bold">"RPC Password"</span>, enter
            <input-copy class="my-1" :value="urls.bitcoin.rpc.rpcpassword" auto-width></input-copy>
          </li>
          <li class="connect-wallet-substep">
            In the <span class="font-weight-bold">"Address"</span>, enter
            <input-copy class="my-1" :value="`${urls.bitcoin.rpc.address}:${urls.bitcoin.rpc.port}`" auto-width></input-copy>
          </li>
          <li class="connect-wallet-substep">
            Tap <span class="font-weight-bold">"Save"</span>.
          </li>
        </ul>
      </step>
      <step>
        Congratulations! You have successfully connected Fully Noded to your Umbrel.
      </step>
    </step-list>
  </connection-details>
</template>

<script>
import ConnectionDetails from "@/components/ConnectWallet/ConnectionDetails";
import StepList from "@/components/ConnectWallet/StepList";
import Step from "@/components/ConnectWallet/Step";
import InputCopy from "@/components/Utility/InputCopy";
import QrCode from "@/components/Utility/QrCode";

export default {
  props: {
    urls: Object
  },
  components: {
    ConnectionDetails,
    StepList,
    Step,
    InputCopy,
    QrCode
  }
};
</script>

<style lang="scss" scoped></style>
