// Formula text as Excel shows it versus as files store it. Functions newer than
// Excel 2007 are stored with an _xlfn. prefix (FILTER and SORT with
// _xlfn._xlws.), which Excel hides on screen but requires on disk: a saved
// XLOOKUP without it reads as an unknown name and shows #NAME?.

// Excel 2010 through Microsoft 365
const FUTURE_FUNCTIONS = new Set(
	(
		'AGGREGATE BETA.DIST BETA.INV BINOM.DIST BINOM.INV CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV ' +
		'CHISQ.INV.RT CHISQ.TEST CONFIDENCE.NORM CONFIDENCE.T COVARIANCE.P COVARIANCE.S ECMA.CEILING ERF.PRECISE ' +
		'ERFC.PRECISE EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FLOOR.PRECISE GAMMA.DIST GAMMA.INV ' +
		'GAMMALN.PRECISE HYPGEOM.DIST ISO.CEILING LOGNORM.DIST LOGNORM.INV MODE.MULT MODE.SNGL NEGBINOM.DIST ' +
		'NETWORKDAYS.INTL NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC ' +
		'PERCENTRANK.INC POISSON.DIST QUARTILE.EXC QUARTILE.INC RANK.AVG RANK.EQ STDEV.P STDEV.S T.DIST T.DIST.2T ' +
		'T.DIST.RT T.INV T.INV.2T T.TEST VAR.P VAR.S WEIBULL.DIST WORKDAY.INTL ' +
		'ACOT ACOTH ARABIC BASE BINOM.DIST.RANGE BITAND BITLSHIFT BITOR BITRSHIFT BITXOR CEILING.MATH COMBINA COT ' +
		'COTH CSC CSCH DAYS DECIMAL ENCODEURL FILTERXML FLOOR.MATH FORMULATEXT GAMMA GAUSS IFNA IMCOSH IMCOT IMCSC ' +
		'IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOWEEKNUM MUNIT NUMBERVALUE PDURATION PERMUTATIONA PHI RRI SEC ' +
		'SECH SHEET SHEETS SKEW.P UNICHAR UNICODE WEBSERVICE XOR ' +
		'FORECAST.ETS FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT FORECAST.LINEAR ' +
		'CONCAT IFS MAXIFS MINIFS SWITCH TEXTJOIN ' +
		'LET RANDARRAY SEQUENCE SORTBY UNIQUE XLOOKUP XMATCH ' +
		'ARRAYTOTEXT BYCOL BYROW CHOOSECOLS CHOOSEROWS DROP EXPAND GROUPBY HSTACK IMAGE ISOMITTED LAMBDA MAKEARRAY ' +
		'MAP PERCENTOF PIVOTBY REDUCE REGEXEXTRACT REGEXREPLACE REGEXTEST SCAN STOCKHISTORY TAKE TEXTAFTER ' +
		'TEXTBEFORE TEXTSPLIT TOCOL TOROW TRIMRANGE VALUETOTEXT VSTACK WRAPCOLS WRAPROWS'
	).split(' '),
)
const WORKSHEET_FUNCTIONS = new Set(['FILTER', 'SORT'])

const PREFIXES = /^(?:_xlfn\.|_xlws\.)+/i

// The formula as Excel displays it: prefixes off
export function displayFormula(formula: string): string {
	if (!/_xl/i.test(formula)) return formula
	return rewriteFunctions(formula, (name) => name.replace(PREFIXES, ''))
}

// The formula as a file must store it: prefixes on wherever a newer function needs one
export function fileFormula(formula: string): string {
	return rewriteFunctions(formula, (name) => {
		const bare = name.replace(PREFIXES, '')
		const upper = bare.toUpperCase()
		if (WORKSHEET_FUNCTIONS.has(upper)) return `_xlfn._xlws.${bare}`
		return FUTURE_FUNCTIONS.has(upper) ? `_xlfn.${bare}` : bare
	})
}

// Replaces each function name (the word before a '(') outside string literals, quoted sheet names and bracketed
// table or workbook references
function rewriteFunctions(formula: string, rename: (name: string) => string): string {
	let out = ''
	let copied = 0
	for (let i = 0; i < formula.length; ) {
		const c = formula.charCodeAt(i)
		if (c === 34 || c === 39) {
			// "text" and 'sheet name', with the quote doubled to escape it
			i++
			while (i < formula.length) {
				if (formula.charCodeAt(i++) !== c) continue
				if (formula.charCodeAt(i) !== c) break
				i++
			}
		} else if (c === 91) {
			// [Table1[[#This Row],[Column]]], where an apostrophe escapes the next character
			let depth = 0
			for (; i < formula.length; i++) {
				const b = formula.charCodeAt(i)
				if (b === 39) i++
				else if (b === 91) depth++
				else if (b === 93 && --depth === 0) break
			}
			i++
		} else if (isWordChar(c)) {
			const start = i
			while (i < formula.length && isWordChar(formula.charCodeAt(i))) i++
			if (formula.charCodeAt(i) !== 40) continue
			const name = formula.slice(start, i)
			const renamed = rename(name)
			if (renamed !== name) {
				out += formula.slice(copied, start) + renamed
				copied = i
			}
		} else i++
	}
	return copied ? out + formula.slice(copied) : formula
}

// Letters, digits, _ . \ and anything non-ASCII: whatever can make up a name
const isWordChar = (c: number) =>
	(c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 46 || c === 92 || c > 127
