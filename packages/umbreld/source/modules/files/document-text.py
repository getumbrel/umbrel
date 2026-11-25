# Writes the text of the document on standard input to standard output, a
# form feed between its pages where it has them (slides, sheets). The kind of
# document is the one argument: its file extension. umbreld runs this in the
# sandbox, like every tool that reads a user's file (see readDocumentText).
#
#   .docx .pptx .xlsx .odt .odp .ods   Office Open XML and OpenDocument: a ZIP
#                                      of XML, whose text is what is between
#                                      the tags of the parts that hold it
#   .html .htm                         a web page: what it says, without its
#                                      scripts, styles and tags
#   .rtf                               Rich Text: what it says, without what
#                                      says how it looks
#
# Everything here is in Python's own library.

import codecs
import html
import io
import re
import sys
import zipfile
from html.parser import HTMLParser

# No more of a part of a document than this is read
LIMIT = 64 * 1024 * 1024
# ... and of a web page or Rich Text, which are mostly not text, this: more
# than umbreld keeps of what any document says
MARKUP_LIMIT = 8 * 1024 * 1024


def office(data):
	archive = zipfile.ZipFile(io.BytesIO(data))
	names = archive.namelist()

	def number(name):
		return [int(digits) for digits in re.findall(r'\d+', name)]

	if 'word/document.xml' in names:
		parts = ['word/document.xml']
	elif 'content.xml' in names:
		parts = ['content.xml']
	elif any(name.startswith('ppt/slides/slide') for name in names):
		parts = sorted((name for name in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', name)), key=number)
	else:
		parts = [name for name in names if name == 'xl/sharedStrings.xml']
	pages = []
	for part in parts:
		if archive.getinfo(part).file_size > LIMIT:
			continue
		xml = archive.read(part).decode('utf-8', 'replace')
		# Who changed or noted what, and when, is not what the document says
		xml = re.sub(r'<(office:annotation|text:tracked-changes)[ >].*?</\1>', '', xml, flags=re.S)
		xml = re.sub(r'</(w:p|a:p|text:p|text:h|si|draw:page)>', '\n', xml)
		xml = re.sub(r'<(w:tab|text:tab|w:br|text:line-break|text:s)(\s[^>]*)?/?>', ' ', xml)
		pages.append(html.unescape(re.sub(r'<[^>]+>', '', xml)))
	return '\f'.join(pages)


def known(encoding):
	try:
		return codecs.lookup(encoding).name
	except LookupError:
		return None


class Page(HTMLParser):
	"""A web page's text, a line to a block"""

	UNSEEN = {'script', 'style', 'template', 'noscript'}
	BLOCKS = set('p div br li tr h1 h2 h3 h4 h5 h6 section article blockquote pre table ul ol title header footer'.split())

	def __init__(self):
		super().__init__(convert_charrefs=True)
		self.text = []
		self.unseen = 0

	def handle_starttag(self, tag, attributes):
		if tag in self.UNSEEN:
			self.unseen += 1
		elif tag in self.BLOCKS:
			self.text.append('\n')
		elif tag in ('td', 'th'):
			self.text.append(' ')

	def handle_endtag(self, tag):
		if tag in self.UNSEEN:
			self.unseen = max(0, self.unseen - 1)
		elif tag in self.BLOCKS:
			self.text.append('\n')

	def handle_data(self, data):
		if not self.unseen:
			self.text.append(data)


def page(data):
	# In the encoding its first bytes mark it as, or it says it is in, or
	# UTF-8, or failing that what Windows wrote before there was UTF-8
	said = re.search(rb'charset\s*=\s*["\']?\s*([\w.:-]+)', data[:4096], re.I)
	if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
		text = data.decode('utf-16', 'replace')
	else:
		for encoding in [said and known(said.group(1).decode('ascii')), 'utf-8']:
			try:
				text = data.decode(encoding or 'utf-8')
				break
			except (UnicodeError, LookupError):
				# Not in that encoding, or what it names is not one of text
				continue
		else:
			text = data.decode('cp1252', 'replace')
	parser = Page()
	parser.feed(text)
	parser.close()
	return ''.join(parser.text)


# Rich Text is its text between groups in braces and control words that start
# with a backslash. Most control words say how it looks. A few are text: a
# paragraph's end, a character by its number, a byte of the document's code
# page. Some groups are not text at all: its fonts, colours and pictures.
RTF_TOKEN = re.compile(rb"\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|[\r\n]+|([^\\{}\r\n]+)")
RTF_UNSEEN = set(
	b'fonttbl colortbl stylesheet info pict object header footer headerl headerr headerf footerl footerr footerf'
	b' footnote themedata colorschememapping datastore latentstyles'.split()
)
RTF_TEXT = {
	**dict.fromkeys([b'par', b'line', b'sect', b'page', b'row'], '\n'),
	**dict.fromkeys([b'tab', b'cell'], ' '),
	**{b'emdash': '—', b'endash': '–', b'bullet': '•', b'emspace': ' ', b'enspace': ' '},
	**{b'lquote': '‘', b'rquote': '’', b'ldblquote': '“', b'rdblquote': '”'},
}
RTF_SYMBOLS = {b'~': ' ', b'_': '-', b'\\': '\\', b'{': '{', b'}': '}'}


def rich_text(data):
	text = []
	# The bytes of the document's code page that are waiting to be made into
	# characters: in Japanese and Chinese ones a character is two of them
	held = bytearray()
	encoding = 'cp1252'
	# For each open group: whether what is in it is not text, and how many
	# characters after a \u stand in for it where it cannot be shown
	groups = [(False, 1)]
	# How many of those are still to come
	standing_in = 0
	at = 0

	def flush():
		if held:
			text.append(held.decode(encoding, 'replace'))
			held.clear()

	while at < len(data):
		token = RTF_TOKEN.match(data, at)
		if not token:
			at += 1
			continue
		at = token.end()
		word, number, byte, symbol, brace, plain = token.groups()
		unseen, stand = groups[-1]
		if byte:
			if standing_in:
				standing_in -= 1
			elif not unseen:
				held.append(int(byte, 16))
			continue
		if plain:
			skipped, standing_in = min(standing_in, len(plain)), max(0, standing_in - len(plain))
			if not unseen:
				flush()
				text.append(plain[skipped:].decode('latin-1'))
			continue
		standing_in = 0
		flush()
		if brace == b'{':
			# The group it opens in, not a copy of it: a file can open millions
			groups.append(groups[-1])
		elif brace == b'}':
			if len(groups) > 1:
				groups.pop()
		elif symbol:
			if symbol == b'*':
				groups[-1] = (True, stand)
			elif not unseen:
				text.append(RTF_SYMBOLS.get(symbol, ''))
		elif word:
			word = word.lower()
			if word in RTF_UNSEEN:
				groups[-1] = (True, stand)
			elif word == b'bin':
				# This many bytes of something that is not text follow
				at += max(0, int(number or 0))
			elif word == b'ansicpg':
				encoding = known(f'cp{int(number or 1252)}') or 'cp1252'
			elif word == b'uc':
				groups[-1] = (unseen, max(0, int(number or 1)))
			elif unseen:
				pass
			elif word == b'u' and number:
				text.append(chr(int(number) % 65536))
				standing_in = stand
			elif word in RTF_TEXT:
				text.append(RTF_TEXT[word])
	flush()
	# Characters outside the first 65,536 are written as two halves
	return ''.join(text).encode('utf-16', 'surrogatepass').decode('utf-16', 'replace')


kind = sys.argv[1]
if kind in ('.html', '.htm'):
	text = page(sys.stdin.buffer.read(MARKUP_LIMIT))
elif kind == '.rtf':
	text = rich_text(sys.stdin.buffer.read(MARKUP_LIMIT))
else:
	text = office(sys.stdin.buffer.read())
sys.stdout.buffer.write(text.encode('utf-8', 'replace'))
