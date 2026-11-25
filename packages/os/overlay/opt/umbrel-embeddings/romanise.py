"""Writes Hindi in the Latin letters its speakers type it in.

Speech in Hindi, and in Urdu and Marathi, which the recogniser writes as
Hindi, is written down in Devanagari. People who speak it mostly type it in
Latin letters ("main yahan hoon"), and that is how they search for it. So what
is said in Devanagari is kept spelt that way (see speech.py).

AI4Bharat's IndicXlit spells each word: a small transformer that reads a word
a character at a time and writes it a letter at a time. It is run here from
the file its authors publish, a checkpoint of fairseq's, with numpy alone:
only the model's weights are taken out of it, and nothing in it is run. The
commonest words of Hindi come from a table instead (hindi-words.tsv): they are
most of what is said, and the model's first spelling of those is often an
English word ("how" for हो, "call" for कल).
"""

import math
import os
import pickle
import re
import zipfile

# numpy would otherwise start a thread for every core to multiply the small
# tables that are all it is given here
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')

import numpy as np  # noqa: E402

LAYERS = 6
SIZE = 256
HEADS = 4
# What fairseq numbers before the characters of each dictionary ...
START, PAD, END, UNKNOWN = 0, 1, 2, 3
SPECIAL = ['<s>', '<pad>', '</s>', '<unk>']
# ... and after them: a mark for each language the model was trained on. A
# word is read after the mark of its language.
LANGUAGES = 'en as bn brx gom gu hi kn ks mai ml mni mr ne or pa sa sd si ta te ur'.split()
# The languages written in Devanagari, which is all that is spelt here
DEVANAGARI = frozenset('hi mr ne sa mai brx gom'.split())
WORD = re.compile('[ऀ-ॣॱ-ॿ]+')
# How many spellings are kept under way, and how long one can get: what
# fairseq does, which is what the model's authors measured it with
BEAM = 4
LONGEST = 200
LONGEST_WORD = 60
# What Devanagari ends a sentence with and counts in
PUNCTUATION = str.maketrans({'।': '.', '॥': '.', **{digit: str(value) for value, digit in enumerate('०१२३४५६७८९')}})
# Marks that join letters and are not ones themselves
JOINERS = str.maketrans('', '', '‌‍')

FLOAT = {'FloatStorage': np.float32, 'HalfStorage': np.float16, 'DoubleStorage': np.float64}


class Unused:
	"""Whatever a checkpoint holds that is not a tensor"""

	def __init__(self, *arguments, **named):
		pass

	def __setstate__(self, state):
		pass


class Listed(dict):
	"""The dictionary the tensors are listed in, which PyTorch also notes things on"""


def weights(path):
	"""The model's weights out of a checkpoint as PyTorch saves one: a ZIP of
	each tensor's numbers and a pickle that says which is which. Nothing in
	the pickle is run: a tensor is made of its numbers here, the dictionary
	they are listed in is Python's own, and everything else is left empty."""
	with zipfile.ZipFile(path) as archive:
		listing = next(name for name in archive.namelist() if name.endswith('/data.pkl'))
		numbers = {}

		class Reader(pickle.Unpickler):
			def find_class(self, module, name):
				if (module, name) == ('collections', 'OrderedDict'):
					return Listed
				if (module, name) == ('torch._utils', '_rebuild_tensor_v2'):
					return lambda stored, offset, size, *rest: None if stored is None else stored[offset : offset + math.prod(size)].reshape(size)
				if module == 'torch' and name.endswith('Storage'):
					return name
				return Unused

			def persistent_load(self, storage):
				_, kind, key, *_ = storage
				if kind not in FLOAT:
					return None
				if key not in numbers:
					numbers[key] = np.frombuffer(archive.read(f'{listing[:-9]}/data/{key}'), FLOAT[kind])
				return numbers[key]

		with archive.open(listing) as file:
			return {name: tensor.astype(np.float32) for name, tensor in Reader(file).load()['model'].items() if tensor is not None}


def erf(x):
	"""The error function, which numpy lacks, to within a ten-millionth"""
	t = 1 / (1 + 0.3275911 * np.abs(x))
	series = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
	return np.sign(x) * (1 - series * np.exp(-x * x))


def symbols(path):
	"""A dictionary of fairseq's: a character and how often it was seen to a line"""
	with open(path, encoding='utf-8') as file:
		listed = [line.rstrip('\n').rsplit(' ', 1)[0] for line in file if line.strip()]
	return SPECIAL + listed + [f'__{language}__' for language in LANGUAGES]


class Romaniser:
	def __init__(self, checkpoint, source, target):
		self.weights = weights(checkpoint)
		# What a layer multiplies by, turned the way it is multiplied
		self.across = {name: np.ascontiguousarray(table.T) for name, table in self.weights.items() if table.ndim == 2}
		self.source = {symbol: index for index, symbol in enumerate(symbols(source))}
		self.target = symbols(target)
		# The letters among what it can write: the rest are marks of its own
		self.letters = [not symbol.startswith(('<', '__', 'madeupword')) for symbol in self.target]
		# Where a character is in a word is told by adding these to it
		half = SIZE // 2
		angles = np.arange(LONGEST + 60)[:, None] * np.exp(np.arange(half) * -(math.log(10000) / (half - 1)))[None]
		self.places = np.concatenate([np.sin(angles), np.cos(angles)], 1).astype(np.float32)
		with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hindi-words.tsv'), encoding='utf-8') as file:
			self.common = dict(line.rstrip('\n').split('\t') for line in file if line.strip())
		self.spelt = {}

	def linear(self, x, name):
		# One multiplication of two tables, which is what numpy is fast at
		y = x.reshape(-1, x.shape[-1]) @ self.across[f'{name}.weight']
		return y.reshape(*x.shape[:-1], -1) + self.weights[f'{name}.bias']

	def norm(self, x, name):
		x = x - x.mean(-1, keepdims=True)
		return x / np.sqrt((x * x).mean(-1, keepdims=True) + 1e-5) * self.weights[f'{name}.weight'] + self.weights[f'{name}.bias']

	def heads(self, x):
		"""[.., length, SIZE] as each of the heads sees it: [.., HEADS, length, SIZE / HEADS]"""
		return x.reshape(*x.shape[:-1], HEADS, SIZE // HEADS).swapaxes(-2, -3)

	def seen(self, over, name):
		"""What there is to look at, as an attention looks at it: its keys and values"""
		return self.heads(self.linear(over, f'{name}.k_proj')), self.heads(self.linear(over, f'{name}.v_proj'))

	def attend(self, x, seen, name):
		"""What each of `x` takes from what it looks at"""
		keys, values = seen
		looks = self.heads(self.linear(x, f'{name}.q_proj')) * (SIZE // HEADS) ** -0.5
		much = looks @ keys.swapaxes(-1, -2)
		much = np.exp(much - much.max(-1, keepdims=True))
		taken = (much / much.sum(-1, keepdims=True)) @ values
		return self.linear(taken.swapaxes(-2, -3).reshape(x.shape), f'{name}.out_proj')

	def think(self, x, name):
		y = self.linear(self.norm(x, f'{name}.final_layer_norm'), f'{name}.fc1')
		return x + self.linear(y * 0.5 * (1 + erf(y / math.sqrt(2))), f'{name}.fc2')

	def embed(self, tokens, first, side):
		"""Characters as the model takes them, the first of them at a place in the word"""
		x = self.weights[f'{side}.embed_tokens.weight'][tokens] * math.sqrt(SIZE)
		# Places are counted from after the padding's number
		places = self.places[PAD + 1 + first : PAD + 1 + first + tokens.shape[-1]]
		return self.norm(x + places, f'{side}.layernorm_embedding')

	def read(self, tokens):
		"""What the model makes of a word, as each layer that writes looks at it"""
		x = self.embed(np.array(tokens), 0, 'encoder')
		for layer in range(LAYERS):
			name = f'encoder.layers.{layer}'
			h = self.norm(x, f'{name}.self_attn_layer_norm')
			x = self.think(x + self.attend(h, self.seen(h, f'{name}.self_attn'), f'{name}.self_attn'), name)
		x = self.norm(x, 'encoder.layer_norm')
		return [self.seen(x, f'decoder.layers.{layer}.encoder_attn') for layer in range(LAYERS)]

	def write(self, read, letters, place, written):
		"""How likely each letter is to come next, as logarithms, for each of
		several spellings under way: [spellings, letters]. `letters` is the
		last letter of each. `written` is what each layer saw of the letters
		before it, and is given back with this one added."""
		x = self.embed(letters[:, None], place, 'decoder')
		for layer in range(LAYERS):
			name = f'decoder.layers.{layer}'
			h = self.norm(x, f'{name}.self_attn_layer_norm')
			# A letter is written knowing only the ones before it
			keys, values = self.seen(h, f'{name}.self_attn')
			if written[layer]:
				keys, values = (np.concatenate(both, 2) for both in zip(written[layer], (keys, values)))
			written[layer] = keys, values
			x = x + self.attend(h, written[layer], f'{name}.self_attn')
			x = x + self.attend(self.norm(x, f'{name}.encoder_attn_layer_norm'), read[layer], f'{name}.encoder_attn')
			x = self.think(x, name)
		scores = self.norm(x[:, 0], 'decoder.layer_norm') @ self.across['decoder.output_projection.weight']
		scores = scores - scores.max(-1, keepdims=True)
		return scores - np.log(np.exp(scores).sum(-1, keepdims=True))

	def spell(self, word, language):
		"""A word in Latin letters: the likeliest of the spellings found by
		keeping the few likeliest under way a letter at a time, as fairseq does"""
		read = self.read([self.source[f'__{language}__'], *(self.source.get(character, UNKNOWN) for character in word), END])
		longest = min(LONGEST, 3 * (len(word) + 2) + 10)
		spellings = np.full((1, 1), END)
		scores = np.zeros(1, np.float32)
		written = [None] * LAYERS
		finished = []
		for step in range(longest + 1):
			likely = self.write(read, spellings[:, -1], step, written)
			likely[:, PAD] = -np.inf
			if step == 0:
				likely[:, END] = -np.inf
			if step >= longest:
				likely[:, [index for index in range(likely.shape[1]) if index != END]] = -np.inf
			total = (likely + scores[:, None]).ravel()
			best = np.argsort(-total, kind='stable')[: 2 * BEAM]
			of, letters = np.divmod(best, likely.shape[1])
			for rank in range(min(BEAM, len(best))):
				if letters[rank] == END and total[best[rank]] > -np.inf and len(finished) < BEAM:
					finished.append((total[best[rank]] / (step + 1), spellings[of[rank], 1:]))
			if len(finished) >= BEAM or step >= longest:
				break
			kept = [rank for rank in range(len(best)) if letters[rank] != END][:BEAM]
			spellings = np.concatenate([spellings[of[kept]], letters[kept, None]], 1)
			scores = total[best[kept]]
			written = [(keys[of[kept]], values[of[kept]]) for keys, values in written]
		# The first found of those as likely
		likeliest = max(finished, key=lambda found: found[0])[1]
		return ''.join(self.target[index] for index in likeliest if self.letters[index])

	def romanise(self, text, language='hi'):
		"""A text with every word of it that is in Devanagari spelt in Latin
		letters, and everything else as it was"""
		language = language if language in DEVANAGARI else 'hi'

		def spelt(found):
			word = found.group()
			if word in self.common:
				return self.common[word]
			# Nothing that long is a word
			if len(word) > LONGEST_WORD:
				return word
			if (language, word) not in self.spelt:
				self.spelt[language, word] = self.spell(word, language) or word
			return self.spelt[language, word]

		return WORD.sub(spelt, text.translate(JOINERS)).translate(PUNCTUATION)


# Loaded once there is something to spell
loaded = []


def romanised(models, text, language='hi'):
	"""A text with what is in Devanagari spelt in Latin letters. `models` is
	where the model's files are, under the names models.json in umbreld gives them."""
	if not WORD.search(text):
		return text
	if not loaded:
		loaded.append(Romaniser(*(f'{models}/speech-romaniser{part}' for part in ('.pt', '-source.txt', '-target.txt'))))
	return loaded[0].romanise(text, language)
