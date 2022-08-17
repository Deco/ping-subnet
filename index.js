const os = require('os');
const EventEmitter = require('events');

const ping = require('ping');

const ipUtils = require('./ipUtils');

class SubnetsPinger extends EventEmitter {
  constructor(_ranges, _niFilter) {
    super();

    if (_ranges) {
      this.ranges = _ranges.filter(range => {
        if(range.split('-').length == 2) {
          const [leftBound, rightBound] = range.split('-');
          return ipUtils.isIP(leftBound) && ipUtils.isIP(rightBound);
        } else {
          return ipUtils.isIP(range);
        }
      }).map(range => {
        if(range.split('-').length == 2) {
          const [leftBound, rightBound] = range.split('-');
          return {leftBound, rightBound};
        } else {
          return {leftBound: range, rightBound: range};
        }
      });
    } else {
      this.ranges = Object.entries(os.networkInterfaces())
      .flatMap(([networkInterfaceName, networkInterface]) => networkInterface.flatMap(entry => {
        if(entry.internal) return [];
        if(entry.family != 4) return [];
        if(_niFilter && !_niFilter(entry)) return [];
        const { address, netmask } = entry;
        const addressNumber = ipUtils.ip2number(address) >>> 0;
        const netmaskNumber = ipUtils.ip2number(netmask) >>> 0;
        const baseAddress = ipUtils.number2ip(addressNumber & netmaskNumber);
        let bitMask;

        for (let i = 32; i >= 0; i--) {
          if (netmaskNumber == (0xffffffff << (32 - i)) >>> 0) {
            bitMask = i;
          }
        }

        return [{
          leftBound: bitMask <= 30
            ? ipUtils.number2ip((addressNumber & netmaskNumber) + 1)
            : baseAddress,
          rightBound: bitMask <= 30
            ? ipUtils.number2ip((addressNumber & netmaskNumber) + Math.pow(2, 32 - bitMask) - 2)
            : ipUtils.number2ip((addressNumber & netmaskNumber) + Math.pow(2, 32 - bitMask) - 1)
        }];
      }));
    }
  }

  ping() {
    const ips = this.ips;
    const loop = () => {
      let ip;
      if (ip = ips.pop()) {
        ping.promise.probe(ip).then(target => {
          if (target.alive) {
            this.emit('host:alive', target.host);
          } else {
            this.emit('host:dead', target.host);
          }
          loop();
        });
      } else {
        setTimeout(() => this.emit('ping:end'), 300);
      }
    };
    for (let i = 0; i < os.cpus().length * 5; i++) {
      process.nextTick(() => {
        loop();
      });
    }
  }

  get ips() {
    const ips = [];
    for (let i = 0; i < this.ranges.length; i++) {
      const startRange = ipUtils.ip2number(this.ranges[i].leftBound);
      const endRange = ipUtils.ip2number(this.ranges[i].rightBound);
      for (let j = startRange; j <= endRange; j++) {
        if(!ips.includes(ipUtils.number2ip(j))) {
          ips.push(ipUtils.number2ip(j));
        }
      }
    }

    return ips;
  }
}

module.exports = SubnetsPinger;
