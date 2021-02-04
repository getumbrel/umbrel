var baseRoute = "";

if(bitcoinNetwork == "testnet") {
  baseRoute = "test/v2";
} else {
  baseRoute = "v2"
}

var pairingRequest = `http://node:8080/${baseRoute}/${supportPrefix}/pairing`

// TESTNET: GET /test/v2/support/pairing
// MAINNET: GET /v2/support/pairing

/* Returns

{
  "pairing": {
    "type": "dojo.api",
    "version": "1.8.0",
    "apikey": "00000000000000000000000000000000",
  }
}

*/

var pairingInfo = "" // Request response

pairingInfo.pairing.url = `http://${dojoHiddenService}/${baseRoute}`

// Encode pairingInfo in a QR code to be scanned by Dojo