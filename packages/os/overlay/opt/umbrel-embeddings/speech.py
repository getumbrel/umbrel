#!/usr/bin/env python3
"""Writes down what is said in a recording for umbreld, a sentence at a time,
with when.

Silero VAD finds the stretches where someone is speaking. Whisper tiny hears
the first half minute of them and tells what language it is. Parakeet TDT v3
then writes down the 25 European languages it knows, with a time for every
word, and Qwen3-ASR every other. The detector runs in ONNX Runtime. The rest
run in transcribe.cpp, unpacked at /opt/transcribe, on the CPU or on a GPU
(see serving.py for how this listens).

  POST /transcribe      sound as 16 kHz mono 16-bit samples -> a JSON array
                        with, for each sentence said, startMs, endMs and text
  POST /transcribe/gpu  the same, written down on a GPU. null where there is
                        none that can be trusted with it.

What is said in Hindi comes spelt in the Latin letters its speakers type it
in (see romanise.py), with what the recogniser wrote beside it as `original`.

A GPU driver can start and still compute nonsense. So before a GPU is given a
recogniser, each one there is hears a stretch that the CPU has just written
down, and the fastest that writes the same is the one used. One that writes
something else, or fails later, is left alone for as long as this runs.
"""

import argparse
import os
import re
import sys
import time
from difflib import SequenceMatcher

from romanise import romanised  # noqa: I001 (before numpy, which it sets up)

import numpy as np
import onnxruntime

from serving import serve

os.environ.setdefault('TRANSCRIBE_LIBRARY', '/opt/transcribe/libtranscribe.so')
sys.path.insert(0, '/opt/transcribe')
import transcribe_cpp  # noqa: E402

parser = argparse.ArgumentParser()
# Where the models are, under the names models.json in umbreld gives them
parser.add_argument('--models', required=True)
parser.add_argument('--idle-seconds', type=float, help='exit after this long without a request')
arguments = parser.parse_args()

RATE = 16000
# On the CPU: a quarter of the cores, which is what umbreld's background work
# has between all it does (see faces.py)
THREADS = max(1, len(os.sched_getaffinity(0)) // 4)
# The detector hears 32 ms at a time, after the end of the 32 ms before
FRAME = 512
CONTEXT = 64
# Speech starts when the detector is this sure of it and ends when it is less
# sure than the second, so that it does not flicker between the two ...
SPEECH = 0.5
QUIET = 0.35
# ... for this many frames (half a second), of which this many (a quarter of
# a second) are kept either side of what was said. A word starts more quietly
# than the detector is sure of: with a tenth of a second kept, the first
# syllable of a recording was lost.
PAUSE = 16
KEPT = 8
# Qwen3-ASR needs more memory the more it hears at once. So a stretch that has
# gone on this long (15 s) ends at the first quiet frame, and at the second
# (20 s) wherever it is.
SOON = 15 * RATE // FRAME
LONGEST = 20 * RATE // FRAME
# How much speech tells what language it is in
LANGUAGE_SAMPLE = 30 * RATE
# The languages Parakeet v3 writes down. It is several times as fast as
# Qwen3-ASR and times every word, so they are its.
PARAKEET_LANGUAGES = frozenset('bg cs da de el en es et fi fr hr hu it lt lv mt nl pl pt ro ru sk sl sv uk'.split())
# Languages of India that neither writes down. Found for an earlier version
# of search: Qwen3-ASR hears them as languages it knows and writes words that
# were never said, so speech in them is left unwritten.
UNWRITTEN = frozenset('as bn gu kn ml pa sd si ta te'.split())
# A sentence ends where it does once it has gone on this long, and where it
# has got to at the second
SENTENCE_MS = 2_000
LONGEST_SENTENCE_MS = 12_000
# What ends a sentence in Latin, Greek and Cyrillic script, in Chinese and
# Japanese, Hindi, Arabic and Urdu
SENTENCE_ENDS = tuple('.?!。？！।؟۔')
# Where what Qwen3-ASR wrote, which comes without times, can be cut: at its
# spaces, and after the punctuation of scripts written without any
PIECE = re.compile(r'\s*(?:[^\s。？！、，；：]+[。？！、，；：]*|[。？！、，；：]+)')
# A GPU is tried on a stretch with this many letters in it, of which it has to
# write this share as the CPU did. One that works writes all of them, or all but.
TELLING = 20
AGREEMENT = 0.7


def model(name):
	return f'{arguments.models}/speech-{name}'


# The library would otherwise write a line about every stretch to the journal
transcribe_cpp.set_log_callback(lambda level, message: level in (2, 3) and print(message.strip(), file=sys.stderr))

single = onnxruntime.SessionOptions()
single.intra_op_num_threads = single.inter_op_num_threads = 1
detector = onnxruntime.InferenceSession(model('detector.onnx'), single, providers=['CPUExecutionProvider'])

devices = transcribe_cpp.backends()
CPU = next(device for device in devices if device.kind == 'cpu')
GPUS = [device for device in devices if device.kind != 'cpu']
# The language is told on the CPU: half a minute takes it under a second
language = transcribe_cpp.Model(model('whisper.gguf'), device=CPU).session(n_threads=THREADS)
# Whichever of the two recognisers was needed last, and where. Each holds
# about a gigabyte, so the other is let go before one is loaded.
loaded = {}
# For each recogniser a GPU has been tried with, the one that is its: None
# where none is
trusted = {}


def recogniser(name, device, threads):
	if (name, device, threads) not in loaded:
		for held, session in loaded.values():
			session.close()
			held.close()
		loaded.clear()
		held = transcribe_cpp.Model(model(f'{name}.gguf'), device=device)
		loaded[name, device, threads] = held, held.session(n_threads=threads)
	return loaded[name, device, threads][1]


def write(name, device, sound, threads=1):
	"""What a recogniser on a device makes of a stretch of speech"""
	try:
		return recogniser(name, device, threads).run(sound, timestamps='word' if name == 'parakeet' else 'none')
	except transcribe_cpp.OutputRepetition:
		# Qwen3-ASR writes a word at a time and can fall into saying one over
		# and over. What it has by then was not said.
		return None
	except transcribe_cpp.OutputTruncated as error:
		# ... or run out of room. What it wrote until then was said.
		return error.partial_result


def letters(text):
	return ''.join(character for character in text.lower() if character.isalnum())


def try_gpus(name, sound, written):
	"""The fastest GPU that writes a stretch as the CPU wrote it"""
	best, fastest = None, None
	for gpu in GPUS:
		try:
			# The first time a GPU hears anything it is also building what it runs
			write(name, gpu, sound)
			started = time.monotonic()
			heard = write(name, gpu, sound)
			took = time.monotonic() - started
		except transcribe_cpp.TranscribeError as error:
			print(f'{gpu.description} does not write speech down: {error}', file=sys.stderr)
			continue
		same = SequenceMatcher(None, letters(written), letters(heard.text if heard else ''), autojunk=False).ratio()
		print(f'{gpu.description} writes {same:.0%} of what the CPU does with {name}, in {took:.2f} s', file=sys.stderr)
		if same >= AGREEMENT and (fastest is None or took < fastest):
			best, fastest = gpu, took
	return best


def hear(name, sound, gpu):
	# Asked for a GPU, umbreld has given this one core: what is written on the
	# CPU meanwhile, before a GPU has been tried or after one has failed, is
	# written on one
	if not gpu or trusted.get(name, CPU) is None:
		return write(name, CPU, sound, 1 if gpu else THREADS)
	if name not in trusted:
		result = write(name, CPU, sound)
		if result and len(letters(result.text)) >= TELLING:
			trusted[name] = try_gpus(name, sound, result.text)
		return result
	try:
		return write(name, trusted[name], sound)
	except transcribe_cpp.TranscribeError as error:
		# What the CPU cannot write down either was not the GPU's doing, and
		# fails as it would have
		result = write(name, CPU, sound)
		print(f'{trusted[name].description} failed, so speech is the CPU\'s: {error}', file=sys.stderr)
		trusted.update(parakeet=None, qwen=None)
		return result


def stretches(samples):
	"""Where someone is speaking: each stretch's first sample and its sound"""
	state = np.zeros((2, 1, 128), np.float32)
	context = np.zeros(CONTEXT, np.float32)
	rate = np.array(RATE, np.int64)
	first, quiet, last = None, 0, 0
	for index in range(len(samples) // FRAME):
		frame = samples[index * FRAME : (index + 1) * FRAME]
		sure, state = detector.run(None, {'input': np.concatenate((context, frame))[None], 'state': state, 'sr': rate})
		context = frame[-CONTEXT:]
		if first is None:
			if sure.item() >= SPEECH:
				first, quiet = max(last, index - KEPT), 0
			continue
		quiet = quiet + 1 if sure.item() < QUIET else 0
		length = index + 1 - first
		if quiet >= (PAUSE if length < SOON else 1) or length >= LONGEST:
			last = index + 1 - max(quiet - KEPT, 0)
			yield first * FRAME, samples[first * FRAME : last * FRAME]
			first = None
	if first is not None:
		yield first * FRAME, samples[first * FRAME :]


def spread(text, start, end):
	"""The pieces of what was said in a stretch, each given a share of the
	time it took that goes by its length"""
	pieces = PIECE.findall(text)
	each = (end - start) / max(1, sum(len(piece.strip()) for piece in pieces))
	for piece in pieces:
		yield piece, start, start + each * len(piece.strip())
		start += each * len(piece.strip())


def sentences(pieces):
	"""Pieces of speech, each with when it starts and ends, as the sentences they make"""
	said = []
	for text, start, end in pieces:
		if said:
			length = start - said[-1]['startMs']
			ended = said[-1]['text'].endswith(SENTENCE_ENDS) and length >= SENTENCE_MS
		if not said or ended or length >= LONGEST_SENTENCE_MS:
			said.append({'startMs': start, 'text': ''})
		said[-1]['text'] += text
		said[-1]['endMs'] = end
	return [{'startMs': round(one['startMs']), 'endMs': round(one['endMs']), 'text': one['text'].strip()} for one in said]


def transcribe(body, gpu=False):
	# Whichever recogniser a GPU was not trusted with, none is asked of it again
	if gpu and (not GPUS or None in trusted.values()):
		return None
	samples = np.frombuffer(body[: len(body) // 2 * 2], np.int16).astype(np.float32) / 32768
	spoken = list(stretches(samples))
	if not spoken:
		return []
	tongue = language.run(np.concatenate([sound for _, sound in spoken])[:LANGUAGE_SAMPLE], timestamps='none').language
	if tongue in UNWRITTEN:
		return []
	name = 'parakeet' if tongue in PARAKEET_LANGUAGES else 'qwen'
	said = []
	for first, sound in spoken:
		result = hear(name, sound, gpu)
		if not result:
			continue
		start, end = first * 1000 / RATE, (first + len(sound)) * 1000 / RATE
		if name == 'parakeet':
			pieces = ((f' {word.text}', start + word.t0_ms, start + word.t1_ms) for word in result.words)
		else:
			pieces = spread(result.text, start, end)
		said.extend(sentences(pieces))
	for sentence in said:
		spelt = romanised(arguments.models, sentence['text'], tongue)
		if spelt != sentence['text']:
			sentence.update(text=spelt, original=sentence['text'])
	return [sentence for sentence in said if sentence['text']]


serve({'/transcribe': transcribe, '/transcribe/gpu': lambda body: transcribe(body, True)}, arguments.idle_seconds)
