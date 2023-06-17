import { BigNumber } from "bignumber.js";

// Never display numbers as exponents
BigNumber.config({ EXPONENTIAL_AT: 1e9 });

export function btcToSats(input) {
  const btc = new BigNumber(input);
  const sats = btc.multipliedBy(100000000);

  if (isNaN(sats)) {
    return 0;
  }

  return Number(sats);
}

export function satsToBtc(input, decimals = 8) {
  const sats = new BigNumber(input);
  const btc = sats.dividedBy(100000000);

  if (isNaN(btc)) {
    return 0;
  }

  return Number(btc.decimalPlaces(decimals));
}

export function toPrecision(input, decimals = 8) {
  const number = new BigNumber(input);

  if (isNaN(number)) {
    return 0;
  }

  return number.decimalPlaces(decimals).toString();
}
