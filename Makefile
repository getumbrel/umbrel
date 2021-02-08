all: # nothing to build

install:
	mkdir -p $(DESTDIR)/usr/umbrel/
	mkdir -p $(DESTDIR)/etc/systemd/system
	rsync -avr --exclude='scripts/umbrel-os' --exclude='debian' --exclude='.git*' --exclude='Makefile' . $(DESTDIR)/usr/umbrel/
	cp scripts/debian/services/umbrel-startup.service $(DESTDIR)/etc/systemd/system/umbrel-startup.service
