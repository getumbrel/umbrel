#!/usr/bin/env python3
"""Serves EmbeddingGemma 2 embeddings to umbreld over a unix socket.

The model runs in LiteRT-LM, unpacked at /opt/litert-lm. umbrelOS runs this
three times (the umbrel-embeddings units): with only the text half of the
model for search queries, with the same half for the passages of documents
and speech, and with the model that also reads images for photos and videos
(see serving.py for how they listen).

  POST /embed/text   the text         -> its embedding, a JSON array of 768 numbers
  POST /embed/image  an image's bytes -> the same for what the image shows
  POST /on           nothing           -> where the model reads, "gpu" or "cpu"
  POST /romanise     a search query   -> the same with what is in Devanagari
                                         spelt in Latin letters (see
                                         romanise.py), as a JSON string
"""

import argparse
import os
import subprocess
import sys

from serving import Rejected, serve

sys.path.insert(0, '/opt/litert-lm')
import litert_lm  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--images', action='store_true', help='the model reads images, on the GPU where there is one')
parser.add_argument('--background', action='store_true', help='read on the cores background work has, not on all of them')
parser.add_argument('--romaniser', help='spell queries in Latin letters, with the models in this directory')
parser.add_argument('--idle-seconds', type=float, help='exit after this long without a request')
arguments = parser.parse_args()

litert_lm.set_min_log_severity(litert_lm.LogSeverity.WARNING)
OPTIONS = litert_lm.EmbeddingOptions(normalize=True, input_overflow_strategy=litert_lm.InputOverflowStrategy.TRUNCATE)
# A search is answered on every core. What is read in the background has the
# cores background work has (see faces.py).
CORES = len(os.sched_getaffinity(0))
THREADS = max(1, CORES // 4) if arguments.background else CORES
CPU = litert_lm.Backend.CPU(thread_count=THREADS)


def load():
	# systemd's CacheDirectory: where LiteRT-LM keeps what it compiles for the GPU
	settings = {'cache_dir': os.environ.get('CACHE_DIRECTORY')}
	if not arguments.images:
		return litert_lm.EmbeddingEngine(arguments.model, backend=CPU, **settings), 'cpu'
	# 70 tokens an image: the fewest the model takes, and the quickest to read
	settings['vision_tokens_per_image'] = 70
	# umbreld has it read on the CPU where the device is short of memory: on
	# a GPU that shares the device's memory, what the GPU holds of the model is
	# several times what the CPU needs of it
	if os.environ.get('UMBREL_SEARCH_MODEL_ON') != 'cpu':
		try:
			gpu = litert_lm.Backend.GPU()
			return litert_lm.EmbeddingEngine(arguments.model, backend=gpu, vision_backend=gpu, **settings), 'gpu'
		except RuntimeError:
			# No GPU it can use: none that Vulkan reaches, or one such as a
			# Raspberry Pi 5's that WebGPU finds no adapter on. The CPU reads
			# images too, at half the speed.
			pass
	return litert_lm.EmbeddingEngine(arguments.model, backend=CPU, vision_backend=CPU, **settings), 'cpu'


engine, on = load()


def embed_text(body):
	return engine.compute_embedding(body.decode(), OPTIONS).embedding


def embed_image(body):
	# LiteRT-LM reads BMP, PNG and JPEG. A video's frame arrives as a JPEG. A
	# photo's preview is WebP, so ImageMagick hands over its pixels as a BMP,
	# which costs nothing to write or read.
	if body[:4] == b'RIFF' and body[8:12] == b'WEBP':
		bitmap = subprocess.run(['convert', 'webp:-', 'bmp:-'], input=body, capture_output=True)
		if bitmap.returncode != 0:
			raise Rejected('not a readable image')
		body = bitmap.stdout
	return engine.compute_embedding([litert_lm.Content.ImageBytes(body)], OPTIONS).embedding


def romanise(body):
	# Only loaded for a query that has something to spell
	from romanise import romanised

	return romanised(arguments.romaniser, body.decode('utf-8', 'replace'))


routes = {'/embed/text': embed_text, '/on': lambda body: on}
if arguments.images:
	routes['/embed/image'] = embed_image
if arguments.romaniser:
	routes['/romanise'] = romanise
serve(routes, arguments.idle_seconds)
