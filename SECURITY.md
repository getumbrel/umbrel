# Security

**Umbrel is currently in beta and is not considered secure.** We are trying to iterate rapidly and build out our vision of what a user friendly Bitcoin and Lightning node should look like. We have so much we want to build and only so many hours on the day. Due to this, we've decided to make some trade-offs with security to allow us to get something working out to users as soon as possible.

We can't consider Umbrel secure due to the following reasons:
- No signature verification on OTA updates.
- No signature verification when pulling Docker images from Docker Hub.
- Large amounts of 3rd-party Node.js dependencies.
- No authentication on the logs stream on the dashboard.

The lack of signature verification means GitHub could backdoor the OTA update process or Docker Hub could backdoor our Docker images. It's quite unlikely that they would do this but currently we just have to trust that they won't. If this were to occur, the current update system would not detect or prevent it.

 During the beta phase we are making use of Node.js and its rich ecosystem of npm packages to rapidly build out features. However the npm ecosystem tends to make use of a large number of small focused modules. This can make audibility difficult as you end up with a huge dependency tree for even relatively simple projects.

 The lack of authentication on the logs page means that, in the correct circumstances, if someone could convince you to visit a malicious website, the website may be able to read the logs of your Umbrel.

 These trade-offs were made to be able to get a beta release out in a reasonable amount of time that included features we required for early testers, such as OTA updates and easy log access.

Umbrel, in its current state, is intended to demonstrate what we have in mind, and show the community what we are building. It's in a state that it can be used and tested, but it's not secure, and **you should not put more funds on your Umbrel than you're prepared to lose.**

The issues raised above will all be resolved before we do a stable release of Umbrel and start recommending Umbrel for serious use.
