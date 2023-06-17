<template>
  <connection-details name="Zeus" requires="lnd">
    <step-list>
      <step>
        Open the Zeus app on your phone.
      </step>
      <step>
        Tap <span class="font-weight-bold">"Scan lndconnect config"</span>.
      </step>
      <step>
        Scan this QR Code (click to enlarge)
        <qr-code
          :value="urls.lnd.restTor.replace(/cert=(.*)&/gm,'')"
          :size="300"
          class="qr-image mt-2"
          showLogo
          @click="$emit('showQrModal', urls.lnd.restTor.replace(/cert=(.*)&/gm,''))"
          v-bind:style="{ cursor: 'pointer' }"
        ></qr-code>
      </step>
      <step>
        Check <span class="font-weight-bold">"Use Tor"</span>.
      </step>
      <step>
        Tap <span class="font-weight-bold">"Save Node Config"</span>.
      </step>
      <step>
        Tap <span class="font-weight-bold">"I understand, save my node config"</span>.
      </step>
      <step>
        Congratulations! You have successfully connected Zeus to your Umbrel.
      </step>
    </step-list>
    <hr />
    <p class="text-muted">Or manually enter the following details</p>
    <step-list>
      <step>
        In the <span class="font-weight-bold">"Host"</span>, enter
        <input-copy
          :value="'https://' + Array.from(urls.lnd.restTor.matchAll(/lndconnect:\/\/(.*):/gm), m => m[1])[0]"
          auto-width
        ></input-copy>
      </step>
      <step>
        In the <span class="font-weight-bold">"REST Port"</span>, enter
        <input-copy class="my-1" value="8080" auto-width></input-copy>
      </step>
      <step>
        In the <span class="font-weight-bold">"Macaroon (Hex format)"</span>, enter
        <input-copy class="my-1" :value="macaroonHex"></input-copy>
      </step>
      <step>
        Check <span class="font-weight-bold">"Use Tor"</span>.
      </step>
      <step>
        Tap <span class="font-weight-bold">"Save Node Config"</span>.
      </step>
      <step>
        Tap <span class="font-weight-bold">"I understand, save my node config"</span>.
      </step>
      <step>
        Congratulations! You have successfully connected Zeus to your Umbrel.
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
  computed: {
    macaroonHex() {
      return Buffer.from(Array.from(this.urls.lnd.restTor.matchAll(/macaroon=(.*)/gm), m => m[1])[0], 'base64').toString('hex');
    }
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
