#!/usr/bin/env python3
"""Tidy Waydroid's first-boot phone dock, and only when it is exactly the known default.

Trebuchet's phone layout reserves two dock slots for a dialer and a messaging app
that Waydroid does not ship, which leaves Contacts twice and a hole. When, and only
when, the dock is byte-for-byte that default, swap in the five apps every Waydroid
image carries. Anything unexpected means we leave the launcher alone.
"""
import pathlib, pwd, shutil, sqlite3, subprocess, sys, time

# Same attach environment `waydroid shell` uses: from a systemd unit the host
# environment leaks into the container otherwise and Android's tools are not on PATH.
ANDROID_ENV = {
    'PATH': '/product/bin:/apex/com.android.runtime/bin:/apex/com.android.art/bin:/system_ext/bin:/system/bin:/system/xbin:/odm/bin:/vendor/bin:/vendor/xbin',
    'ANDROID_ROOT': '/system',
    'ANDROID_DATA': '/data',
    'ANDROID_STORAGE': '/storage',
    'ANDROID_ART_ROOT': '/apex/com.android.art',
    'ANDROID_I18N_ROOT': '/apex/com.android.i18n',
    'ANDROID_TZDATA_ROOT': '/apex/com.android.tzdata',
    'ANDROID_RUNTIME_ROOT': '/apex/com.android.runtime',
}
LXC = (['lxc-attach', '-P', '/var/lib/waydroid/lxc', '-n', 'waydroid', '--clear-env']
       + [option for key, value in ANDROID_ENV.items() for option in ('--set-var', f'{key}={value}')]
       + ['--', '/system/bin/sh', '-c'])
MARKER = pathlib.Path('/var/lib/waydroid/.umbrel-dock')
EXPECTED_VERSION = 31
EXPECTED_COLUMNS = ['_id', 'title', 'intent', 'container', 'screen', 'cellX', 'cellY', 'spanX', 'spanY', 'itemType',
                    'appWidgetId', 'iconPackage', 'iconResource', 'icon', 'appWidgetProvider', 'modified', 'restored',
                    'profileId', 'rank', 'options', 'appWidgetSource']
DOCK, PAGE = -101, -100
LAUNCHER_INTENT = '#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;launchFlags=0x10200000;component={component};end'


def android(command, timeout=30):
    # stderr is left alone so Android's complaints land in the journal
    return subprocess.run(LXC + [command], stdout=subprocess.PIPE, text=True, timeout=timeout).stdout


def finish(result):
    MARKER.write_text(result + '\n')
    print(result)
    sys.exit(0)


def component_of(intent):
    for part in (intent or '').split(';'):
        if part.startswith('component='):
            return part[len('component='):]
    return None


def main():
    if MARKER.exists():
        return finish('skip: already ran (' + MARKER.read_text().strip() + ')')

    user = pwd.getpwuid(1000).pw_name
    db_path = pathlib.Path(f'/home/{user}/.local/share/waydroid/data/data/com.android.launcher3/databases/launcher.db')
    # Android's shell tools only answer once the framework is up, and the
    # launcher creates its database on its first draw shortly after. Give a
    # slow first boot ten minutes; without a marker the service simply tries
    # again next boot, and the exact-match check below keeps that safe.
    for _ in range(120):
        if (android('getprop sys.boot_completed').strip() == '1' and db_path.exists()
                and android('pidof com.android.launcher3').strip()):
            break
        time.sleep(5)
    else:
        print('skip: Android never finished booting')
        return
    # Let the launcher finish its first load, which prunes entries it cannot bind.
    time.sleep(5)

    # Only the phone-sized display we configure gets Trebuchet's phone layout.
    display = android('wm size; wm density')
    if 'Physical size: 720x1560' not in display or 'Physical density: 320' not in display:
        return finish('skip: unexpected display ' + ' '.join(display.split()))

    # The two apps we add have to resolve as launchable activities right now.
    launchable = android('cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER')
    components = {line.strip().split('/')[0]: line.strip() for line in launchable.splitlines() if '/' in line}
    calendar, clock = components.get('org.lineageos.etar'), components.get('com.android.deskclock')
    if not calendar or not clock:
        return finish('skip: calendar or clock not launchable')

    if any(db_path.with_name(db_path.name + suffix).exists() and db_path.with_name(db_path.name + suffix).stat().st_size
           for suffix in ('-journal', '-wal')):
        return finish('skip: launcher database has a pending journal')

    db = sqlite3.connect(db_path)
    try:
        if db.execute('pragma integrity_check').fetchone()[0] != 'ok':
            return finish('skip: launcher database failed integrity check')
        if db.execute('pragma user_version').fetchone()[0] != EXPECTED_VERSION:
            return finish('skip: unexpected launcher database version')
        if [row[1] for row in db.execute('pragma table_info(favorites)')] != EXPECTED_COLUMNS:
            return finish('skip: unexpected favorites schema')

        rows = db.execute('select _id, title, intent, container, screen, cellX, cellY, spanX, spanY, itemType '
                          'from favorites where container = ? or (container = ? and screen = 1 and cellY = 4) '
                          'order by container, screen, cellX', (DOCK, PAGE)).fetchall()
        shape = [(container, screen, cell_x, cell_y, span_x, span_y, item_type, title, (component_of(intent) or '').split('/')[0])
                 for _id, title, intent, container, screen, cell_x, cell_y, span_x, span_y, item_type in rows]
        expected = [
            (DOCK, 0, 0, 0, 1, 1, 0, 'Contacts', 'com.android.contacts'),
            (DOCK, 2, 2, 0, 1, 1, 0, 'Contacts', 'com.android.contacts'),
            (DOCK, 3, 3, 0, 1, 1, 0, 'Browser', 'org.lineageos.jelly'),
            (DOCK, 4, 4, 0, 1, 1, 0, 'Camera', 'org.lineageos.aperture'),
            (PAGE, 1, 1, 4, 1, 1, 0, 'Gallery', 'com.android.gallery3d'),
            (PAGE, 1, 2, 4, 1, 1, 0, 'Music', 'org.lineageos.eleven'),
            (PAGE, 1, 3, 4, 1, 1, 0, 'Settings', 'com.android.settings'),
        ]
        if shape != expected:
            return finish('skip: layout is not the stock default: ' + repr(shape))
        by_slot = {(row[3], row[4], row[5], row[6]): row for row in rows}
        duplicate_contacts = by_slot[(DOCK, 2, 2, 0)]
        gallery = by_slot[(PAGE, 1, 1, 4)]
        template = by_slot[(DOCK, 3, 3, 0)][0]

        backup = db_path.with_name(db_path.name + '.umbrel-backup')
        shutil.copy2(db_path, backup)

        now = int(time.time() * 1000)
        with db:
            db.execute('delete from favorites where _id = ?', (duplicate_contacts[0],))
            db.execute('update favorites set container = ?, screen = 2, cellX = 2, cellY = 0, modified = ? where _id = ?',
                       (DOCK, now, gallery[0]))
            for title, component, container, screen, cell_x, cell_y in (
                ('Calendar', calendar, DOCK, 1, 1, 0),
                ('Clock', clock, PAGE, 1, 1, 4),
            ):
                db.execute(
                    'insert into favorites (title, intent, container, screen, cellX, cellY, spanX, spanY, itemType, '
                    'appWidgetId, modified, restored, profileId, rank, options, appWidgetSource) '
                    'select ?, ?, ?, ?, ?, ?, 1, 1, 0, -1, ?, restored, profileId, 0, options, appWidgetSource '
                    'from favorites where _id = ?',
                    (title, LAUNCHER_INTENT.format(component=component), container, screen, cell_x, cell_y, now, template))

        result = [(container, screen, cell_x, title) for container, screen, cell_x, title in db.execute(
            'select container, screen, cellX, title from favorites where container = ? or (container = ? and screen = 1 and cellY = 4) '
            'order by container, screen, cellX', (DOCK, PAGE))]
        wanted = [(DOCK, 0, 0, 'Contacts'), (DOCK, 1, 1, 'Calendar'), (DOCK, 2, 2, 'Gallery'), (DOCK, 3, 3, 'Browser'),
                  (DOCK, 4, 4, 'Camera'), (PAGE, 1, 1, 'Clock'), (PAGE, 1, 2, 'Music'), (PAGE, 1, 3, 'Settings')]
        if result != wanted:
            db.close()
            shutil.copy2(backup, db_path)
            return finish('skip: rewrite did not verify, restored backup: ' + repr(result))
    finally:
        db.close()

    # The launcher only writes its in-memory layout back on user changes, so it
    # still holds the stock one. Kill it and the system relaunches Home from disk.
    android('am force-stop com.android.launcher3')
    time.sleep(2)
    android('am start -W -a android.intent.action.MAIN -c android.intent.category.HOME')
    time.sleep(4)
    reloaded = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        after = reloaded.execute('select container, screen, cellX, title from favorites where container = ? '
                                 'or (container = ? and screen = 1 and cellY = 4) order by container, screen, cellX',
                                 (DOCK, PAGE)).fetchall()
    finally:
        reloaded.close()
    finish('applied' if after == wanted else 'applied but launcher changed it on reload: ' + repr(after))


if __name__ == '__main__':
    main()
