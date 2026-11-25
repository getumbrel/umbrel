#!/usr/bin/env python3
"""Reads the text in a picture for umbreld.

The models are PP-OCRv6's: its tiny detector marks where in a picture there is
text, and its small recogniser reads one line of it at a time. It reads Latin
script, Chinese and Japanese. Both run on the CPU in ONNX Runtime (see
serving.py for how this listens).

  POST /text  an image's bytes -> a JSON array with, for each line of text,
              text, box: [x, y, width, height] as fractions of the picture,
              and score: how sure the recogniser is of what it read
"""

import argparse
import os

import numpy as np
import onnxruntime

from pictures import decode, scaled, warp
from serving import serve

parser = argparse.ArgumentParser()
parser.add_argument('--detector', required=True)
parser.add_argument('--recogniser', required=True)
parser.add_argument('--idle-seconds', type=float, help='exit after this long without a request')
arguments = parser.parse_args()

# Lines are looked for in the picture scaled to this along its longer side,
# and read from the picture as it came. Measured for an earlier version of
# search: looking at a 1280 px preview whole takes twice as long to find a
# tenth more text.
DETECTOR_SIDE = 1280
# The detector takes sides that are multiples of this
DETECTOR_STEP = 32
# What the detector's colours were scaled by when it was trained (blue, green, red)
DETECTOR_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
DETECTOR_SPREAD = np.array([0.229, 0.224, 0.225], np.float32)
# A pixel the detector is this sure of is text, and a run of them it is this
# sure of on average is a line. Both are lower than the detector's makers
# use: found for an earlier version of search to keep small and faint text
# that this detector marks less firmly than the one theirs were chosen for.
TEXT = 0.2
MIN_LINE_SURENESS = 0.4
# Anything smaller than this, in the detector's pixels, is a speck
MIN_LINE_SIDE = 3
# The detector marks the middle of a line. The line itself reaches this much
# further out: this, times the marked area over the length of its edge.
GROWTH = 1.4
# The recogniser reads a line this high, at least this wide (the rest left
# empty), and squeezed if it would be longer than the last
LINE_HEIGHT = 48
MIN_LINE_WIDTH = 320
MAX_LINE_WIDTH = 2400
# A line that stands this much taller than it is wide reads downwards, and is
# turned on its side to be read
UPRIGHT = 1.5
# What the recogniser is less sure of than this is as often something that
# only looks like writing
MIN_SCORE = 0.5
# ... and so is a line with fewer letters and digits than this, a Chinese or
# Japanese character counting as two: of 1,665 lines read off 200 photos, the
# 500 shorter were mostly an icon or a logo read as a letter
MIN_LETTERS = 4

options = onnxruntime.SessionOptions()
# A quarter of the cores, as the face models have and for the same reason (see faces.py)
options.intra_op_num_threads = max(1, len(os.sched_getaffinity(0)) // 4)
# A picture is read a line at a time, in many short runs. Left to, the threads
# spin between them while they wait for the next (see faces.py).
options.add_session_config_entry('session.intra_op.allow_spinning', '0')
detector = onnxruntime.InferenceSession(arguments.detector, options, providers=['CPUExecutionProvider'])
recogniser = onnxruntime.InferenceSession(arguments.recogniser, options, providers=['CPUExecutionProvider'])
# What the recogniser can read is listed in the model itself. It answers with
# one of them, a space, or nothing, for every few pixels along the line.
CHARACTERS = ['', *recogniser.get_modelmeta().custom_metadata_map['character'].splitlines(), ' ']


def groups(marked):
	"""Every group of marked pixels that touch, corners included, as the rows
	and columns of its pixels"""
	# A row's marked pixels are a few runs of them. Two runs in neighbouring
	# rows are in one group when they touch.
	edges = np.diff(np.pad(marked, ((0, 0), (1, 1))).astype(np.int8), axis=1)
	rows, starts = np.nonzero(edges == 1)
	ends = np.nonzero(edges == -1)[1]
	group = list(range(len(rows)))

	def of(run):
		while group[run] != run:
			group[run] = group[group[run]]
			run = group[run]
		return run

	first = np.searchsorted(rows, np.arange(marked.shape[0] + 1))
	for row in range(1, marked.shape[0]):
		above, below = first[row - 1], first[row]
		while above < first[row] and below < first[row + 1]:
			if starts[above] <= ends[below] and starts[below] <= ends[above]:
				group[of(below)] = of(above)
			if ends[above] < ends[below]:
				above += 1
			else:
				below += 1
	found = {}
	for run in range(len(rows)):
		found.setdefault(of(run), []).append(run)
	for runs in found.values():
		xs = np.concatenate([np.arange(starts[run], ends[run]) for run in runs])
		ys = np.concatenate([np.full(ends[run] - starts[run], rows[run]) for run in runs])
		yield ys, xs


def clockwise(corners):
	"""A rectangle's corners from the one nearest the picture's top left"""
	left, right = np.split(corners[np.argsort(corners[:, 0])], 2)
	(top_left, bottom_left), (top_right, bottom_right) = left[np.argsort(left[:, 1])], right[np.argsort(right[:, 1])]
	return np.array([top_left, top_right, bottom_right, bottom_left])


def lines(pixels):
	"""Where each line of text is: its four corners in the picture, from its
	top left clockwise. A line on a sign is seldom level."""
	height, width = pixels.shape[:2]
	scale = min(1, DETECTOR_SIDE / max(height, width))
	across = max(DETECTOR_STEP, round(width * scale / DETECTOR_STEP) * DETECTOR_STEP)
	down = max(DETECTOR_STEP, round(height * scale / DETECTOR_STEP) * DETECTOR_STEP)
	looked = scaled(pixels, across, down)[..., ::-1] / 255
	blob = ((looked - DETECTOR_MEAN) / DETECTOR_SPREAD).transpose(2, 0, 1)[None].astype(np.float32)
	sureness = detector.run(None, {detector.get_inputs()[0].name: blob})[0][0, 0]
	found = []
	for ys, xs in groups(sureness > TEXT):
		if sureness[ys, xs].mean() < MIN_LINE_SURENESS:
			continue
		# The narrowest rectangle around the group lies along the direction its
		# pixels are spread out in most
		points = np.stack([xs, ys], 1).astype(np.float32) + 0.5
		middle = points.mean(0)
		spread = np.cov((points - middle).T) if len(points) > 1 else np.eye(2)
		along = np.linalg.eigh(spread)[1][:, 1]
		across_line = np.array([-along[1], along[0]])
		reach, rise = (points - middle) @ along, (points - middle) @ across_line
		length, thickness = np.ptp(reach) + 1, np.ptp(rise) + 1
		if min(length, thickness) < MIN_LINE_SIDE:
			continue
		grown = length * thickness * GROWTH / (2 * (length + thickness))
		centre = middle + along * (reach.max() + reach.min()) / 2 + across_line * (rise.max() + rise.min()) / 2
		half_length, half_thickness = along * (length / 2 + grown), across_line * (thickness / 2 + grown)
		corners = clockwise(
			np.array(
				[
					centre - half_length - half_thickness,
					centre + half_length - half_thickness,
					centre + half_length + half_thickness,
					centre - half_length + half_thickness,
				]
			)
		)
		found.append(corners * [width / across, height / down])
	# From the top of the picture down
	return sorted(found, key=lambda corners: (corners[:, 1].min(), corners[:, 0].min()))


def read(pixels, corners):
	"""The text of one line, and how sure the recogniser is of it"""
	top_left, top_right, _, bottom_left = corners
	if np.linalg.norm(bottom_left - top_left) > UPRIGHT * np.linalg.norm(top_right - top_left):
		top_left, top_right, _, bottom_left = np.roll(corners, -1, 0)
	along, down = top_right - top_left, bottom_left - top_left
	width = int(np.clip(round(LINE_HEIGHT * np.linalg.norm(along) / max(1, np.linalg.norm(down))), 1, MAX_LINE_WIDTH))
	# Each pixel of the line is the middle of the patch of the picture it stands for
	step = np.stack([along / width, down / LINE_HEIGHT], 1)
	matrix = np.concatenate([step, (top_left + step.sum(1) / 2 - 0.5)[:, None]], 1).astype(np.float32)
	line = warp(pixels, matrix, width, LINE_HEIGHT)[..., ::-1]
	blob = np.zeros((1, 3, LINE_HEIGHT, max(MIN_LINE_WIDTH, width)), np.float32)
	blob[0, :, :, :width] = ((line / 255 - 0.5) / 0.5).transpose(2, 0, 1)
	answers = recogniser.run(None, {recogniser.get_inputs()[0].name: blob})[0][0]
	# The same answer several times running is one character
	best = answers.argmax(1)
	kept = (best != 0) & (best != np.concatenate([[0], best[:-1]]))
	text = ''.join(CHARACTERS[index] for index in best[kept]).strip()
	return text, float(answers.max(1)[kept].mean()) if kept.any() else 0.0


def letters(written):
	return sum(2 if '\u3040' <= character <= '\u30ff' or '\u4e00' <= character <= '\u9fff' else 1 for character in written if character.isalnum())


def text(body):
	pixels = decode(body)
	height, width = pixels.shape[:2]
	found = []
	for corners in lines(pixels):
		written, score = read(pixels, corners)
		if score < MIN_SCORE or letters(written) < MIN_LETTERS:
			continue
		left, top = np.clip(corners.min(0) / [width, height], 0, 1)
		right, bottom = np.clip(corners.max(0) / [width, height], 0, 1)
		found.append({'text': written, 'box': [float(left), float(top), float(right - left), float(bottom - top)], 'score': score})
	return found


serve({'/text': text}, arguments.idle_seconds)
