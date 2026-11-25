"""Pictures as umbreld sends them to the models that look at them, and the
one thing those models all do to a picture before they do: take part of it
out, turned and scaled."""

import subprocess

import numpy as np

from serving import Rejected


def decode(body):
	"""The picture's pixels, as rows of RGB"""
	# A photo's preview is WebP and a video's frame JPEG. ImageMagick is told
	# which, and hands the pixels over behind a three-line header, once it has
	# dropped any comment in the file that would be a line of its own there.
	coder = 'webp' if body[:4] == b'RIFF' and body[8:12] == b'WEBP' else 'jpeg'
	image = subprocess.run(
		['convert', f'{coder}:-', '-strip', '-depth', '8', 'ppm:-'], input=body, capture_output=True
	)
	if image.returncode != 0:
		raise Rejected('not a readable image')
	_, size, _, pixels = image.stdout.split(b'\n', 3)
	width, height = map(int, size.split())
	return np.frombuffer(pixels, np.uint8).reshape(height, width, 3)


def warp(pixels, matrix, width, height):
	"""`pixels` seen through `matrix`, which takes a point of the result to
	where it comes from, blending the four pixels around that spot"""
	ys, xs = np.mgrid[:height, :width].astype(np.float32)
	x = np.clip(matrix[0, 0] * xs + matrix[0, 1] * ys + matrix[0, 2], 0, pixels.shape[1] - 1)
	y = np.clip(matrix[1, 0] * xs + matrix[1, 1] * ys + matrix[1, 2], 0, pixels.shape[0] - 1)
	left, top = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
	right, bottom = np.minimum(left + 1, pixels.shape[1] - 1), np.minimum(top + 1, pixels.shape[0] - 1)
	across, down = (x - left)[..., None], (y - top)[..., None]
	upper = pixels[top, left] * (1 - across) + pixels[top, right] * across
	lower = pixels[bottom, left] * (1 - across) + pixels[bottom, right] * across
	return upper * (1 - down) + lower * down


def scaled(pixels, width, height):
	"""The whole picture at another size. Each pixel of the result is the
	middle of the patch it stands for."""
	across, down = pixels.shape[1] / width, pixels.shape[0] / height
	return warp(pixels, np.array([[across, 0, (across - 1) / 2], [0, down, (down - 1) / 2]], np.float32), width, height)
