// Source from https://github.com/richardschneider/bitcoin-convert/
const Big = require('big.js');
const BTC = 1;
const SAT = 0.00000001;

const units = {
  btc: new Big(BTC),
  sat: new Big(SAT),
};

function convert(from, fromUnit, toUnit, representation) {
  const fromFactor = units[fromUnit];
  if (fromFactor === undefined) {
    throw new Error(`'${fromUnit}' is not a bitcoin unit`);
  }
  const toFactor = units[toUnit];
  if (toFactor === undefined) {
    throw new Error(`'${toUnit}' is not a bitcoin unit`);
  }

  if (Number.isNaN(from)) {
    if (!representation || representation === 'Number') {
      return from;
    } else if (representation === 'Big') {
      return new Big(from); // throws BigError
    } else if (representation === 'String') {
      return from.toString();
    }
    throw new Error(`'${representation}' is not a valid representation`);
  }

  const result = new Big(from).times(fromFactor).div(toFactor);

  if (!representation || representation === 'Number') {
    return Number(result);
  } else if (representation === 'Big') {
    return result;
  } else if (representation === 'String') {
    return result.toString();
  }

  throw new Error(`'${representation}' is not a valid representation`);
}

convert.units = function () {
  return Object.keys(units);
};

convert.addUnit = function addUnit(unit, factor) {
  const bigFactor = new Big(factor);
  const existing = units[unit];
  if (existing && !existing.eq(bigFactor)) {
    throw new Error(`'${unit}' already exists with a different conversion factor`);
  }
  units[unit] = bigFactor;
};

const predefinedUnits = convert.units();
convert.removeUnit = function removeUnit(unit) {
  if (predefinedUnits.indexOf(unit) >= 0) {
    throw new Error(`'${unit}' is predefined and cannot be removed`);
  }
  delete units[unit];
};

module.exports = convert;
