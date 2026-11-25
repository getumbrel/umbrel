#!/usr/bin/env python3
"""Finds the faces in a picture for umbreld, and embeds each one so that a
person's faces can be told from everyone else's.

The models are InsightFace's buffalo_l pair: SCRFD finds the faces and five
points on each (eyes, nose, corners of the mouth), and ArcFace embeds a face
once it has been turned and scaled to put those points where it expects
them. Both run on the CPU in ONNX Runtime (see serving.py for how this
listens).

  POST /faces  an image's bytes -> a JSON array with, for each face,
               box: [x, y, width, height] as fractions of the picture,
               score: how sure the detector is, and embedding: 512 numbers
"""

import argparse
import os

import numpy as np
import onnxruntime

from pictures import decode, warp
from serving import serve

parser = argparse.ArgumentParser()
parser.add_argument('--detector', required=True)
parser.add_argument('--recogniser', required=True)
parser.add_argument('--idle-seconds', type=float, help='exit after this long without a request')
arguments = parser.parse_args()

# The detector looks at the picture scaled into a square this size
DETECTOR_SIZE = 640
# Below this it is as likely something else as a face
MIN_SCORE = 0.5
# Two boxes that overlap this much are one face
MAX_OVERLAP = 0.4
# Where ArcFace expects the five points to be in the 112px face it is given
FACE_SIZE = 112
TEMPLATE = np.array(
	[[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]],
	np.float32,
)

options = onnxruntime.SessionOptions()
# A quarter of the cores, which is what umbreld's background work has between
# all it does: umbreld has nothing else of it running while this is at work
options.intra_op_num_threads = max(1, len(os.sched_getaffinity(0)) // 4)
# Left to, the threads spin while they wait for the next thing to do, and use
# a core each to go slower
options.add_session_config_entry('session.intra_op.allow_spinning', '0')
detector = onnxruntime.InferenceSession(arguments.detector, options, providers=['CPUExecutionProvider'])
recogniser = onnxruntime.InferenceSession(arguments.recogniser, options, providers=['CPUExecutionProvider'])


def detect(pixels):
	"""Every face's box, score and five points, in the picture's own pixels"""
	scale = max(pixels.shape[:2]) / DETECTOR_SIZE
	# Each of the square's pixels is the middle of the patch it stands for
	shrink = np.array([[scale, 0, (scale - 1) / 2], [0, scale, (scale - 1) / 2]], np.float32)
	square = warp(pixels, shrink, DETECTOR_SIZE, DETECTOR_SIZE)
	# Past the picture's edge the square is empty, not the edge repeated
	square[int(pixels.shape[0] / scale) :] = 0
	square[:, int(pixels.shape[1] / scale) :] = 0
	blob = ((square - 127.5) / 128).transpose(2, 0, 1)[None].astype(np.float32)
	outputs = detector.run(None, {detector.get_inputs()[0].name: blob})
	found = []
	# Three sets of answers, for faces at three sizes: at each one a score, a
	# box and five points for each of two anchors at every `stride` pixels
	for index, stride in enumerate((8, 16, 32)):
		scores = outputs[index].reshape(-1)
		boxes = outputs[index + 3].reshape(-1, 4) * stride
		points = outputs[index + 6].reshape(-1, 5, 2) * stride
		side = DETECTOR_SIZE // stride
		centres = np.stack(np.mgrid[:side, :side][::-1], -1).reshape(-1, 2).repeat(2, 0).astype(np.float32) * stride
		kept = scores >= MIN_SCORE
		centres, boxes, points = centres[kept], boxes[kept], points[kept]
		# A box is given as how far each side is from the anchor's centre
		corners = np.concatenate([centres - boxes[:, :2], centres + boxes[:, 2:]], 1)
		for score, corner, five in zip(scores[kept], corners, points + centres[:, None]):
			found.append((float(score), corner * scale, five * scale))
	found.sort(key=lambda face: -face[0])
	faces = []
	for face in found:
		if all(overlap(face[1], other[1]) <= MAX_OVERLAP for other in faces):
			faces.append(face)
	return faces


def overlap(first, second):
	"""How much of two boxes' combined area they share"""
	width = min(first[2], second[2]) - max(first[0], second[0])
	height = min(first[3], second[3]) - max(first[1], second[1])
	if width <= 0 or height <= 0:
		return 0
	shared = width * height
	area = lambda box: (box[2] - box[0]) * (box[3] - box[1])
	return shared / (area(first) + area(second) - shared)


def alignment(points):
	"""The turn, scale and shift that best take the template's five points to
	this face's (Umeyama's method), so the face can be read into the template"""
	template_centre, points_centre = TEMPLATE.mean(0), points.mean(0)
	template, face = TEMPLATE - template_centre, points - points_centre
	u, spread, vt = np.linalg.svd(face.T @ template / len(TEMPLATE))
	flip = np.ones(2)
	if np.linalg.det(u) * np.linalg.det(vt) < 0:
		flip[1] = -1
	turn = u @ np.diag(flip) @ vt
	scale = (spread * flip).sum() / template.var(0).sum()
	return np.concatenate([scale * turn, (points_centre - scale * turn @ template_centre)[:, None]], 1)


def embed(pixels, points):
	face = warp(pixels, alignment(points), FACE_SIZE, FACE_SIZE)
	blob = ((face - 127.5) / 127.5).transpose(2, 0, 1)[None].astype(np.float32)
	embedding = recogniser.run(None, {recogniser.get_inputs()[0].name: blob})[0][0]
	return (embedding / np.linalg.norm(embedding)).tolist()


def faces(body):
	pixels = decode(body)
	height, width = pixels.shape[:2]
	return [
		{
			'box': [float(box[0] / width), float(box[1] / height), float((box[2] - box[0]) / width), float((box[3] - box[1]) / height)],
			'score': score,
			'embedding': embed(pixels, points),
		}
		for score, box, points in detect(pixels)
	]


serve({'/faces': faces}, arguments.idle_seconds)
