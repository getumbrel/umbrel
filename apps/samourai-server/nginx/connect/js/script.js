var baseRoute = bitcoinNetwork == "testnet" ? "test/v2" : "v2";

fetch(`http://${window.location.host}/${baseRoute}/auth/login`, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body: `apikey=${apiKey}`
 })
 .then(response => response.json())
 .then(data => {
    fetch(`http://${window.location.host}/${baseRoute}/${supportPrefix}/pairing`, {
        method: 'GET',
        headers: new Headers({
            'Authorization': 'Bearer ' + data.authorizations.access_token,
            'Content-Type': 'application/json'
        })
    })
    .then(response => response.json())
    .then(data => {
        var pairingInfo = data;
        pairingInfo.pairing.url = `http://${dojoHiddenService}/${baseRoute}`;

        const qrcodeSvg = new QRCode({
          content: JSON.stringify(pairingInfo),
          container: "svg-viewbox",
          padding: 0,
          color: "#000",
          background: "#fff",
          ecl: "M",
        }).svg();
        document.querySelector('.qr-contents').innerHTML = qrcodeSvg;

        document.getElementById('whirpool-hidden-service').innerText = `${whirlpoolHiddenService}`;
    });
 });
