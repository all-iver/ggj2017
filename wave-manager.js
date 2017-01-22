var uuid = require('uuid');
var SAT = require('sat');

var WAVE_DEFAULT_SPEED = 5;

var WaveManager = function (options) {
  this.worldWidth = options.worldWidth;
  this.worldHeight = options.worldHeight;
  this.waveDropInterval = 700;//options.waveDropInterval;
//   this.waveMaxCount = 50;
  this.waveCount = 0;
  if (options.waveMoveSpeed == null) {
    this.waveMoveSpeed = WAVE_DEFAULT_SPEED;
  } else {
    this.waveMoveSpeed = options.waveMoveSpeed;
  }
};

WaveManager.prototype.generateRandomPosition = function () {
  var position = {
    x: Math.round(Math.random() * this.worldWidth),
    y: Math.round(Math.random() * (this.worldHeight * 0.5))
  };
  if (Math.random() > 0.5)
    position.y = Math.round(Math.random() * (this.worldHeight * 0.25));
//   if (Math.random() > 0.5) {
//       position.x = 5;
//   } else {
//       position.x = this.worldWidth - 5;
//   }
//   position.x = Math.round(position.x);
  return position;
};

WaveManager.prototype.addWave = function (options) {
  if (!options) {
    options = {};
  }
  var waveId = uuid.v4();

var position = this.generateRandomPosition();
//   var velocity = new SAT.Vector(-(position.x - this.worldWidth / 2), -(position.y - this.worldHeight/2)); //new SAT.Vector(Math.random() * 5 - 2.5, Math.random() * 5 - 2.5);
var multiplier = (this.worldHeight * 0.5 - position.y) / (this.worldHeight * 0.5);
var velocity = new SAT.Vector(0, 1);
  velocity.normalize();
  var r = Math.random() * 2.5 * multiplier + 1;
  velocity.x *= r;
  velocity.y *= r;
//   var velocity = new SAT.Vector(1.0, 2.0);
//   var angle = Math.atan2(velocity.y, velocity.x);
  var size = Math.random() * 500 * multiplier + 300;
//   var poly = new SAT.Box(new SAT.Vector(0, 0), size, 20).toPolygon();
//   poly.setAngle(angle);
  var wave = {
    id: waveId,
    type: 'wave',
    subtype: null,
    // speed: options.speed == null ? this.waveMoveSpeed : options.speed,
    velocity: velocity,
    started: Date.now(),
    lastCheck: Date.now(),
    startLifespan: Math.random() * 7000 * multiplier + 5000,
    size: size,
    multiplier: multiplier,
    // angle: angle,
    // poly: poly,
    op: {}
  };
  wave.lifespan = wave.startLifespan;
  wave.velocity.x *= (options.speed == null ? this.waveMoveSpeed : options.speed);
  wave.velocity.y *= (options.speed == null ? this.waveMoveSpeed : options.speed);
//   if (options.x && options.y) {
//     wave.x = options.x;
//     wave.y = options.y;
//   } else {
    // var position = this.generateRandomPosition();
    wave.x = position.x;
    wave.y = position.y;
//     if (options.x) {
//       wave.x = options.x;
//     } else {
//       wave.x = position.x;
//     }
//     if (options.y) {
//       wave.y = options.y;
//     } else {
//       wave.y = position.y;
//     }
//   }
    // wave.x = size/2;
    // wave.y = 0;
  this.waveCount++;

  return wave;
};

WaveManager.prototype.removeWave = function (wave) {
  wave.delete = 1;
  this.waveCount --;
};

module.exports.WaveManager = WaveManager;
