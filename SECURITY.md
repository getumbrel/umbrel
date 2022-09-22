# Security Disclosure

**Umbrel is currently in beta and is not considered secure.**

We've decided to make the following trade-offs while Umbrel is in beta to help us ship critical features like over-the-air (OTA) updates.

**No signature verification on OTA updates or when pulling Docker images.**

The lack of signature verification means GitHub as a company could backdoor the OTA update process or Docker Hub could backdoor our Docker images. It's quite unlikely that they would do this but currently we just have to trust that they won't. If this were to occur, the current update system would not detect or prevent it.

**3rd-party Node.js dependencies.**

During the beta phase we are making use of Node.js and its rich ecosystem of npm packages to rapidly build out features. However the npm ecosystem tends to make use of a large number of small focused modules. This can make audibility difficult as you end up with a huge dependency tree for even relatively simple projects.

**Assuming the local network is secure**

Umbrel currently makes the assumption that the local network is secure. This means local network communication is unencrypted using plain text HTTP. (Remote access via Tor is encrypted)

This is pretty much the industry standard when it comes to locally networked devices. All routers and smart devices that expose a web interface work this way. Bootstrapping a secure connection over an insecure network and avoiding MITM attacks without being able to rely on certificate authorities is not an easy problem to solve.

However, we think we can do better and have some interesting ideas on how to make Umbrel safe to run even when the local network is untrusted.

**Relaxed Permissions**

Currently we are being quite liberal with filesystem permissions and root usage. Some background jobs on the host are currently being run as root that don't strictly need to. Also some scripts executed by root are writable by non-root users. The `umbrel` user itself is also currently added to the `docker` group which makes it essentially root.

**No Network Level Sandboxing**

Apps already have process level sandboxing and filesystem level sandboxing but not network level sandboxing. We plan to implement network level sandboxing so one app will not be able to interact with another app over the network. Apps will also not be able to interact with other physical devices on the local network without explicitly asking the user for permission.


-----

**The issues raised above will be resolved before we do a stable release of Umbrel.**
