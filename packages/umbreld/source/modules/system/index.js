import UmbrelModule from '../umbrel-module.js'

// TODO: The system module is responsible for:
// - Issuing system commands like shutdown/restart
// - Monitoring system sensors/metrics
// - Installing security patches on the host
class System extends UmbrelModule {}

export default System
