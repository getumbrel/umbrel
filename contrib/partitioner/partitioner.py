#!/usr/bin/env python3

'''
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
'''

'''
Libraries should be system standard libraries if possible
'''

import os
import sys
import glob
import re

usb_dev_pattern = ['sd.*']
usb_part_pattern = ['sd.[1-9]*']
sd_dev_pattern = ['mmcblk*']
sd_part_pattern = ['mmcblk.p[1-9]*']

def dev_size(device):
    path = '/sys/block/'
    num_sectors = open(path + device + '/size').read().rstrip('\n')
    sector_size = open(path + device + '/queue/hw_sector_size').read().rstrip('\n')
    return (int(num_sectors)*int(sector_size))

def usb_devs():
    devices = []
    for device in glob.glob('/sys/block/*'):
        for pattern in usb_dev_pattern:
            if re.compile(pattern).match(os.path.basename(device)):
                devices.append(os.path.basename(device))
    return devices

def usb_partitions():
    partitions = []
    for device in usb_devs():
        for partition in glob.glob('/sys/block/' + str(device) + '/*'):
            for pattern in usb_part_pattern:
                if re.compile(pattern).match(os.path.basename(partition)):
                    partitions.append(os.path.basename(partition))
    return partitions

def usb_part_size(partition):
    try:
        path = '/sys/block/'
        device = partition[:-1]
        num_sectors = open(path + device + '/' + partition + '/size').read().rstrip('\n')
        sector_size = open(path + device + '/queue/hw_sector_size').read().rstrip('\n')
    except TypeError:
        print("Not enough USB devices available")
        sys.exit(1)
    else:
        return (int(num_sectors)*int(sector_size))

def uuid_table():
    device_table = os.popen('blkid').read().splitlines()
    devices = {}
    for device in device_table:
        dev = device.split(":")[0].split("/")[2]
        uuid = device.split('"')[1]
        devices[dev] = uuid
    return devices

def get_uuid(device):
    uuids = uuid_table()
    return str(uuids[device])

def usb_partition_table():
    table = {}
    for partition in usb_partitions():
        table[partition] = int(usb_part_size(partition))
    return table

'''
Main Entrypoint
'''

def main():
    print('USB Configuration script')
    homedirpath = os.path.expanduser("~umbrel")
    '''
        If /mnt/data doesn't exist
    '''
    if not os.path.exists('/mnt/data'):
        print('Creating data mount')
        os.mkdir('/mnt/data')
    else:
        print('Data mount exists')


    if len(usb_devs()) == 1:
        if len(usb_partitions()) < 1:
            try:
                print("Running parted...")
                os.system('/sbin/parted -s /dev/sda mkpart p ext4 3 100%');
                print('Making first partition');
                os.system('/sbin/mkfs.ext4 -F /dev/sda1');
            except:
                print('Error running parted');
                sys.exit(1);
        else:
            print("Already partitioned")



        if len(usb_partitions()) == 1:
            try:
                os.system('/bin/mount /dev/' + usb_partitions()[0] + ' /mnt/data')
                # if .rekt exists or bitcoin directory doesnt exist (because the drive is a factory default)
                # then wipe the drive and format it with EXT4
                if os.path.exists('/mnt/data/.rekt') or not os.path.exists('/mnt/data/bitcoin'):
                    print('REKT file exists OR bitcoin folder not found... So lets format it')
                    # unmount before format
                    os.system('/bin/umount /mnt/data')
                    print('Initializing filesystem')
                    os.system('/sbin/mkfs.ext4 -F /dev/' + usb_partitions()[0])
                    # remount
                    os.system('/bin/mount -t ext4 /dev/' + usb_partitions()[0] + ' /mnt/data')
                    '''
                    Get Size of SDA and partition info
                    '''
                    first_part = dev_size('sda') / (1000*1000)
                    prune_setting = int(first_part / 2)

                    if first_part < 512000:
                        print("Pruning the config, because drive is less than 512 GB")
                        os.system('/bin/sed -i "s/prune=550/prune=' + str(prune_setting) + '/g;" ' + str(homedirpath) + '/bitcoin/bitcoin.conf')
                    else:
                        print("Switching off pruning, and turn on txindex")
                        os.system('/bin/sed -i "s/prune=550/#prune=550/g;" ' + str(homedirpath) + '/bitcoin/bitcoin.conf')
                        os.system('/bin/sed -i "s/#txindex=1/txindex=1/g;" ' + str(homedirpath) + '/bitcoin/bitcoin.conf')

                    '''
                    Setup secrets, db, bitcoin, nginx, and lnd directory.. as a new install
                    '''
                    print('Setup secrets, db, bitcoin, nginx, tor and lnd directory.. as a new install')
                    os.system('/bin/cp -fr ' + homedirpath + '/secrets /mnt/data')
                    os.system('/bin/cp -fr ' + homedirpath + '/db /mnt/data')
                    os.system('/bin/cp -fr ' + homedirpath + '/bitcoin /mnt/data')
                    os.system('/bin/cp -fr ' + homedirpath + '/lnd /mnt/data')
                    os.system('/bin/cp -fr ' + homedirpath + '/tor /mnt/data')
                    os.system('/bin/cp -fr ' + homedirpath + '/nginx /mnt/data')

                    if not os.path.exists('/mnt/data/swap'):
                        print('Add swap to partition')
                        os.system('sed -i "/CONF_SWAPFILE/s/^#//g; " /etc/dphys-swapfile')
                        os.system('sed -i "s/\/var\/swap/\/mnt\/data\/swap/g; " /etc/dphys-swapfile')
                        os.system('sed -i "s/CONF_SWAPSIZE=100/CONF_SWAPSIZE=2000/g; " /etc/dphys-swapfile')
                        print('Restarting dphys swapfile')
                        os.system('/etc/init.d/dphys-swapfile restart')

                else:
                    '''
                    No need to do anything
                    '''
                    print('REKT file does not exist OR bitcoin folder exists so we will preserve it. But lets check for all the other folders')

                    '''
                    Check other folders in partition3
                    - secrets
                    - db
                    - lnd
                    - nginx
                    - tor
                    '''
                    # Secrets folder
                    if not os.path.exists('/mnt/data/secrets'):
                        print('secrets folder does\'nt exist!')
                        os.system('/bin/cp -fr ' + homedirpath + '/secrets /mnt/data')
                        
                    # tor folder
                    if not os.path.exists('/mnt/data/tor'):
                        print('secrets folder does\'nt exist!')
                        os.system('/bin/cp -fr ' + homedirpath + '/tor /mnt/data')                        

                    # db folder
                    if not os.path.exists('/mnt/data/db'):
                        print('db folder does\'nt exist!')
                        os.system('/bin/cp -fr ' + homedirpath + '/db /mnt/data')

                    # Check LND folder
                    if not os.path.exists('/mnt/data/lnd'):
                        print('lnd folder does\'nt exist!')
                        os.system('/bin/cp -fr ' + homedirpath + '/lnd /mnt/data')

                    # Check nginx folder
                    if not os.path.exists('/mnt/data/nginx'):
                        print('nginx folder does\'nt exist!')
                        os.system('/bin/cp -fr ' + homedirpath + '/nginx /mnt/data')


                print('Unmounting partition')
                os.system('/bin/umount /mnt/data')
            except:
                print("Error mounting the directory")


        # If volume not mounted
        if not os.path.exists(' /mnt/data/lost+found'):
            os.system('/bin/mount -t ext4 /dev/sda1 /mnt/data')

        # Get UUID of the partition we just created
        partitions = usb_partitions()
        first_partition_uuid = get_uuid(partitions[0])

        print('Setup filesystem permissions (UID=1000 GID=1000)')
        os.system('/bin/chown -R 1000.1000 /mnt/data')

        print('Unmounting partition')
        os.system('/bin/umount /mnt/data')

        print('Update /etc/fstab')
        os.system('echo "UUID=' + first_partition_uuid + ' /mnt/data ext4 defaults,noatime 0 0" >> /etc/fstab')

        print('Remounting through /bin/mount')
        os.system('/bin/mount -a');

        print('Remove old folders (after copying)')
        os.system('/bin/rm -fr ' + homedirpath + '/secrets')
        os.system('/bin/rm -fr ' + homedirpath + '/db')
        os.system('/bin/rm -fr ' + homedirpath + '/bitcoin')
        os.system('/bin/rm -fr ' + homedirpath + '/lnd')
        os.system('/bin/rm -fr ' + homedirpath + '/tor')
        os.system('/bin/rm -fr ' + homedirpath + '/nginx')
        print('Set up symlinks')
        os.system('/bin/ln -s /mnt/data/secrets ' + homedirpath + '/secrets')
        os.system('/bin/ln -s /mnt/data/db ' + homedirpath + '/db')
        os.system('/bin/ln -s /mnt/data/bitcoin ' + homedirpath + '/bitcoin')
        os.system('/bin/ln -s /mnt/data/lnd ' + homedirpath + '/lnd')
        os.system('/bin/ln -s /mnt/data/tor ' + homedirpath + '/tor')
        os.system('/bin/ln -s /mnt/data/nginx ' + homedirpath + '/nginx')
    else:
        print('No drives or unexpected number of drives detected!')

'''
Actual entrypoint
'''

if __name__ == '__main__':
    # Check if root
    if os.geteuid() == 0:
        main()
    else:
        print("Must run as root (UID 0)")
