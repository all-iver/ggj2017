/*
  Note that the main run() loop will be executed once per frame as specified by WORLD_UPDATE_INTERVAL in worker.js.
  Behind the scenes, the engine just keeps on building up a cellData tree of all different
  state objects that are present within our current grid cell.
  The tree is a simple JSON object and needs to be in the format:

    {
      player: {
        // ...
      },
      someType: {
        someId: {
          // All properties listed here are required.
          // You can add additional ones.
          id: theValueOfSomeId,
          type: theValueOfSomeType,
          x: someXCoordinateWithinOurCurrentCell,
          y: someYCoordinateWithinOurCurrentCell,
        },
        anotherId: {
          // ...
        }
      }
    }

  You can add new type structures, new properties and new items to the cellData
  as you like. So long as you follow the structure above, the items should show
  up on the front end in the relevant cell in our world (see the handleCellData function in index.html).
  See how CoinManager was implemented for details of how to add items within the cell.

  Note that states which are close to our current cell (based on WORLD_CELL_OVERLAP_DISTANCE)
  but not exactly inside it will still be visible within this cell (they will have an additional
  'external' property set to true).

  External states should not be modified unless they are grouped together with an internal state.
  See the util.groupStates() function near the bottom of this file for details.
*/

var _ = require('lodash');
var rbush = require('rbush');
var SAT = require('sat');
var config = require('./config');
var BotManager = require('./bot-manager').BotManager;
var WaveManager = require('./wave-manager').WaveManager;
var CoinManager = require('./coin-manager').CoinManager;
var distanceToLineSegment = require('distance-to-line-segment');

// This controller will be instantiated once for each
// cell in our world grid.

var CellController = function (options, util) {
  var self = this;

  this.options = options;
  this.cellIndex = options.cellIndex;
  this.util = util;

  this.worldColCount = Math.ceil(config.WORLD_WIDTH / config.WORLD_CELL_WIDTH);
  this.worldRowCount = Math.ceil(config.WORLD_HEIGHT / config.WORLD_CELL_HEIGHT);
  this.worldCellCount = this.worldColCount * this.worldRowCount;
  this.workerCount = options.worker.options.workers;

  this.coinMaxCount = Math.round(config.COIN_MAX_COUNT / this.worldCellCount);
  this.coinDropInterval = config.COIN_DROP_INTERVAL * this.worldCellCount;
  this.waveDropInterval = config.WAVE_DROP_INTERVAL * this.worldCellCount;
  this.botCount = Math.round(config.BOT_COUNT / this.worldCellCount);

  var cellData = options.cellData;

  this.waveManager = new WaveManager({
    worldWidth: config.WORLD_WIDTH,
    worldHeight: config.WORLD_HEIGHT,
    waveDropInterval: this.waveDropInterval
  });

  this.botManager = new BotManager({
    worldWidth: config.WORLD_WIDTH,
    beachSize: config.BEACH_SIZE,
    worldHeight: config.WORLD_HEIGHT,
    botDefaultDiameter: config.BOT_DEFAULT_DIAMETER,
    botMoveSpeed: config.BOT_MOVE_SPEED,
    botMass: config.BOT_MASS,
    botChangeDirectionProbability: config.BOT_CHANGE_DIRECTION_PROBABILITY
  });

  if (!cellData.player) {
    cellData.player = {};
  }

  for (var b = 0; b < this.botCount; b++) {
    var bot = this.botManager.addBot();
    cellData.player[bot.id] = bot;
  }

  this.botMoves = [
    {u: 1},
    {d: 1},
    {r: 1},
    {l: 1}
  ];

  this.coinManager = new CoinManager({
    cellData: options.cellData,
    cellBounds: options.cellBounds,
    playerNoDropRadius: config.COIN_PLAYER_NO_DROP_RADIUS,
    coinMaxCount: this.coinMaxCount,
    coinDropInterval: this.coinDropInterval
  });

  this.lastCoinDrop = 0;
  this.lastWaveDrop = 0;

  config.COIN_TYPES.sort(function (a, b) {
    if (a.probability < b.probability) {
      return -1;
    }
    if (a.probability > b.probability) {
      return 1;
    }
    return 0;
  });

  this.coinTypes = [];
  var probRangeStart = 0;
  config.COIN_TYPES.forEach(function (coinType) {
    var coinTypeClone = _.cloneDeep(coinType);
    coinTypeClone.prob = probRangeStart;
    self.coinTypes.push(coinTypeClone);
    probRangeStart += coinType.probability;
  });

  this.playerCompareFn = function (a, b) {
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  };

  this.diagonalSpeedFactor = Math.sqrt(1 / 2);
};

/*
  The main run loop for our cell controller.
*/
CellController.prototype.run = function (cellData) {
  if (!cellData.player) {
    cellData.player = {};
  }
  if (!cellData.coin) {
    cellData.coin = {};
  }
  if (!cellData.wave) {
    cellData.wave = {};
  }
  var players = cellData.player;
  var coins = cellData.coin;
  var waves = cellData.wave;

  // Sorting is important to achieve consistency across cells.
  var playerIds = Object.keys(players).sort(this.playerCompareFn);
  var waveIds = Object.keys(waves).sort(this.playerCompareFn);

  this.findPlayerOverlaps(playerIds, players, coins, waveIds, waves);
  this.dropCoins(coins);
  this.dropWaves(waves);
  this.generateBotOps(playerIds, players);
  this.updateWaves(waveIds, waves);
  this.applyPlayerOps(playerIds, players, coins);
};

CellController.prototype.dropWaves = function (waves) {
  var now = Date.now();

  if (now - this.lastWaveDrop >= this.waveManager.waveDropInterval) {
    this.lastWaveDrop = now;
    var wave = this.waveManager.addWave();
    if (wave)
      waves[wave.id] = wave;
  }
}

CellController.prototype.dropCoins = function (coins) {
  var now = Date.now();

  if (now - this.lastCoinDrop >= this.coinManager.coinDropInterval &&
    this.coinManager.coinCount < this.coinManager.coinMaxCount) {

    this.lastCoinDrop = now;

    var rand = Math.random();
    var chosenCoinType;

    var numTypes = this.coinTypes.length;
    for (var i = numTypes - 1; i >= 0; i--) {
      var curCoinType = this.coinTypes[i];
      if (rand >= curCoinType.prob) {
        chosenCoinType = curCoinType;
        break;
      }
    }

    if (!chosenCoinType) {
      throw new Error('There is something wrong with the coin probability distribution. ' +
        'Check that probabilities add up to 1 in COIN_TYPES config option.');
    }

    var coin = this.coinManager.addCoin(chosenCoinType.value, chosenCoinType.type, chosenCoinType.radius);
    if (coin) {
      coins[coin.id] = coin;
    }
  }
};

CellController.prototype.generateBotOps = function (playerIds, players, coins) {
  var self = this;

  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    if (player.dead)
      return;
    // States which are external are managed by a different cell, therefore changes made to these
    // states are not saved unless they are grouped with one or more internal states from the current cell.
    // See util.groupStates() method near the bottom of this file for details.
    if (player.subtype == 'bot' && !player.external) {
      var radius = Math.round(player.diam / 2);
      var isBotOnEdge = player.x <= radius || player.x >= config.WORLD_WIDTH - radius ||
          player.y <= radius || player.y >= config.WORLD_HEIGHT - (config.BEACH_SIZE + 3) * 16 * 5 - radius;

      var didIt = false;
      if (player.targetId) {
        var target = players[player.targetId];
        if (target && !target.dead) {
          player.op = {};
          if (target.x > player.x)
            player.op.r = 1;
          if (target.x < player.x)
            player.op.l = 1;
          if (target.y > player.y)
            player.op.d = 1;
          if (target.y < player.y)
            player.op.u = 1;
          didIt = true;
        }
      }

      var isBotPastLowerEdge = player.y >= config.WORLD_HEIGHT - (config.BEACH_SIZE + 1) * 16 * 5;
      var isBotReallyPastLowerEdge = player.y >= config.WORLD_HEIGHT - (config.BEACH_SIZE - 1) * 16 * 5;
      if (isBotReallyPastLowerEdge) {
        player.op = self.botMoves[0];
        player.y -= 1000; //oops
        return;
      }
      if (player.goUp > 0) {
        player.goUp --;
        player.op = self.botMoves[0];
        return;
      }
      if (isBotPastLowerEdge) {
        player.goUp = 10;
        player.op = self.botMoves[0];
        return;
      }
      if (!didIt) {
        if (Math.random() <= player.changeDirProb || isBotOnEdge) {
          var randIndex = Math.floor(Math.random() * self.botMoves.length);
          player.repeatOp = self.botMoves[randIndex];
        }
        if (player.repeatOp) {
          player.op = player.repeatOp;
        }
      }
    }
  });
};

CellController.prototype.keepPlayerOnGrid = function (player) {
  var radius = Math.round(player.diam / 2);

  var leftX = player.x - radius;
  var rightX = player.x + radius;
  var topY = player.y - radius;
  var bottomY = player.y + radius;

  if (leftX < 0) {
    player.x = radius;
  } else if (rightX > config.WORLD_WIDTH) {
    player.x = config.WORLD_WIDTH - radius;
  }
  if (topY < 0) {
    player.y = radius;
  } else if (bottomY > config.WORLD_HEIGHT) {
    player.y = config.WORLD_HEIGHT - radius;
  }
};

CellController.prototype.updateWaves = function (waveIds, waves) {
  var self = this;
  var now = Date.now();

  waveIds.forEach(function (waveId) {
    var wave = waves[waveId];
    wave.x += wave.velocity.x;
    wave.y += wave.velocity.y;
    wave.lifespan -= (now - wave.lastCheck);
    wave.lastCheck = now;
    if (wave.lifespan <= 0 || wave.y >= (config.WORLD_HEIGHT - (config.BEACH_SIZE - 1) * 16 * 5))
      wave.delete = 1;
      // this.waveManager.removeWave(wave);
    // if (wave.x > config.WORLD_WIDTH + 150 || wave.x < -150 || wave.y > config.WORLD_HEIGHT + 150 || wave.y < -150)
    //   wave.delete = 1;
  });
};

CellController.prototype.applyPlayerOps = function (playerIds, players, coins) {
  var self = this;
  var now = Date.now();

  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    if (player.dead)
      return;

    if (!player.lastAttack)
      player.lastAttack = 0;
    if (!player.attackCount)
      player.attackCount = 0;
    if (now - player.lastAttack > config.ATTACK_TIMEOUT)
      player.attacking = false;

    var playerOp = player.op;
    var moveSpeed;
    if (player.subtype == 'bot') {
      moveSpeed = player.speed;
    } else {
      moveSpeed = config.PLAYER_DEFAULT_MOVE_SPEED;
      if (player.y > (config.WORLD_HEIGHT - config.BEACH_SIZE * 16 * 5)) {
        moveSpeed *= 2;
        player.onBeach = true;
      } else {
        player.onBeach = false;
      }
    }

    if (playerOp) {
      var movementVector = {x: 0, y: 0};
      var movedHorizontally = false;
      var movedVertically = false;

      if (playerOp.u) {
        movementVector.y = -moveSpeed;
        player.direction = 'up';
        movedVertically = true;
      }
      if (playerOp.d) {
        movementVector.y = moveSpeed;
        player.direction = 'down';
        movedVertically = true;
      }
      if (playerOp.r) {
        movementVector.x = moveSpeed;
        player.direction = 'right';
        movedHorizontally = true;
      }
      if (playerOp.l) {
        movementVector.x = -moveSpeed;
        player.direction = 'left';
        movedHorizontally = true;
      }
      if (!player.attacking && playerOp.a) {
        player.attacking = true;
        player.attackCount += 1;
        player.lastAttack = now;
      }

      if (movedHorizontally && movedVertically) {
        movementVector.x *= self.diagonalSpeedFactor;
        movementVector.y *= self.diagonalSpeedFactor;
      }

      player.x += movementVector.x;
      player.y += movementVector.y;
    }

    if (player.boost) {
      player.x += player.boost.x;
      player.y += player.boost.y;
      if (!player.boostScore)
        player.boostScore = 0;
      player.boostScore += Math.round((((Date.now() - player.startBoost) / 5000) * player.boost.len()) * player.boostMultiplier);
    }

    if (player.playerOverlaps) {
      player.playerOverlaps.forEach(function (otherPlayer) {
        self.resolvePlayerCollision(player, otherPlayer);
        self.keepPlayerOnGrid(otherPlayer);
      });
      delete player.playerOverlaps;
    }

    if (player.coinOverlaps) {
      player.coinOverlaps.forEach(function (coin) {
        if (self.testCircleCollision(player, coin).collided) {
          player.score += coin.v;
          self.coinManager.removeCoin(coin.id);
        }
      });
      delete player.coinOverlaps;
    }

    self.keepPlayerOnGrid(player);
  });
};

CellController.prototype.findPlayerOverlaps = function (playerIds, players, coins, waveIds, waves) {
  var self = this;

  var playerTree = new rbush();
  var hitAreaList = [];

  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    if (player.dead)
      return;
    if (player.subtype !== 'bot') {
      player.boost = new SAT.Vector(0, 0);
      player.boosting = false;
      return;
    }
    var minDistance = 999999;
    var minTarget = null;
    playerIds.forEach(function (p2) {
      if (p2 == playerId)
        return;
      var player2 = players[p2];
      if (player2.dead || player2.subtype === 'bot')
        return;
      if (player2.y >= (config.WORLD_HEIGHT - config.BEACH_SIZE * 16 * 5))
        return;
      var dist = Math.pow(player2.x - player.x, 2) + Math.pow(player2.y - player.y, 2);
      if (dist < 200 * 200 && (dist < minDistance || minTarget === null)) {
        minDistance = dist;
        minTarget = p2;
      }
    });
    player.targetId = minTarget;
  });

  // fix serialized poly back into a SAT poly
  fixPoly = function(poly) {
    if (poly.points[0].dot)
      return poly;
    var np = new SAT.Polygon(new SAT.Vector(poly.pos.x, poly.pos.y),
        poly.points.map((n) => { return new SAT.Vector(n.x, n.y); }));
    return np;
  };

  waveIds.forEach(function(waveId) {
    var wave = waves[waveId];
    if (!wave)
      return;
    // wave.poly = fixPoly(wave.poly);
    var angle = Math.atan2(wave.velocity.y, wave.velocity.x)
    var points = [];
    // var poly = new SAT.Box(new SAT.Vector(wave.x-75/2, wave.y-wave.size/2), 75, wave.size).toPolygon();

    // wave.poly = new SAT.Polygon(new SAT.Vector(0, 0), 
    //     wave.poly.points.map((n) => { return new SAT.Vector(n.x, n.y); }));
    // poly.pos = new SAT.Vector(wave.x - 75/2, wave.y + wave.size/2);
    // poly.setAngle(angle);
    // poly.pos = new SAT.Vector(wave.x, wave.y);
    playerIds.forEach(function (playerId) {
      var player = players[playerId];
      if (player.dead || player.subtype === 'bot')
        return;
      player.boosting = false;
      // var testPos = new SAT.Vector(player.x, player.y);
      var perp = new SAT.Vector(wave.velocity.x, wave.velocity.y);
      perp.perp().normalize();
      var boostDistance = 25;
      var size = wave.size - boostDistance/2; // for the edges
      var p1 = new SAT.Vector(wave.x - perp.x * size / 2, wave.y - perp.y * size / 2);
      var p2 = new SAT.Vector(wave.x + perp.x * size / 2, wave.y + perp.y * size / 2);
      var dist = distanceToLineSegment(p1.x, p1.y, p2.x, p2.y, player.x, player.y);
      if (dist < boostDistance) {
      // if (SAT.pointInPolygon(testPos, poly)) {
        // console.log(p1.x, p1.y, p2.x, p2.y, wave.x, wave.y, wave.size, dist);
        if (!player.startBoost) {
          player.startBoost = Date.now();
        }
        player.boost = new SAT.Vector(wave.velocity.x, wave.velocity.y);
        player.boostMultiplier = wave.multiplier;
        player.boosting = true;
      }
    });
  });

  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    if (player.dead)
      return;
    player.hitArea = self.generateHitArea(player);
    hitAreaList.push(player.hitArea);
  });

  playerTree.load(hitAreaList);

  playerIds.forEach(function (playerId) {
    var player = players[playerId];
    if (player.dead)
      return;
    playerTree.remove(player.hitArea);
    var hitList = playerTree.search(player.hitArea);
    playerTree.insert(player.hitArea);

    hitList.forEach(function (hit) {
      if (!player.playerOverlaps) {
        player.playerOverlaps = [];
      }
      player.playerOverlaps.push(hit.target);
    });
  });

  var coinIds = Object.keys(coins);
  coinIds.forEach(function (coinId) {
    var coin = coins[coinId];
    var coinHitArea = self.generateHitArea(coin);
    var hitList = playerTree.search(coinHitArea);

    if (hitList.length) {
      // If multiple players hit the coin, give it to a random one.
      var randomIndex = Math.floor(Math.random() * hitList.length);
      var coinWinner = hitList[randomIndex].target;

      if (!coinWinner.coinOverlaps) {
        coinWinner.coinOverlaps = [];
      }
      coinWinner.coinOverlaps.push(coin);
    }
  });

  playerIds.forEach(function (playerId) {
    if (players[playerId].dead)
      return;
    delete players[playerId].hitArea;
  });
};

CellController.prototype.generateHitArea = function (target) {
  var targetRadius = target.r || Math.round(target.diam / 2);
  return {
    target: target,
    minX: target.x - targetRadius,
    minY: target.y - targetRadius,
    maxX: target.x + targetRadius,
    maxY: target.y + targetRadius
  };
};

CellController.prototype.generateSearchArea = function (target) {
  var targetRadius = 500;
  return {
    target: target,
    minX: target.x - targetRadius,
    minY: target.y - targetRadius,
    maxX: target.x + targetRadius,
    maxY: target.y + targetRadius
  };
};

CellController.prototype.testCircleCollision = function (a, b) {
  var radiusA = a.r || Math.round(a.diam / 2);
  var radiusB = b.r || Math.round(b.diam / 2);

  var circleA = new SAT.Circle(new SAT.Vector(a.x, a.y), radiusA);
  var circleB = new SAT.Circle(new SAT.Vector(b.x, b.y), radiusB);

  var response = new SAT.Response();
  var collided = SAT.testCircleCircle(circleA, circleB, response);

  return {
    collided: collided,
    overlapV: response.overlapV
  };
};

CellController.prototype.resolvePlayerCollision = function (player, otherPlayer) {
  var result = this.testCircleCollision(player, otherPlayer);

  if (result.collided) {
    var olv = result.overlapV;

    var totalMass = player.mass + otherPlayer.mass;
    var playerBuff = player.mass / totalMass;
    var otherPlayerBuff = otherPlayer.mass / totalMass;

    player.x -= olv.x * otherPlayerBuff;
    player.y -= olv.y * otherPlayerBuff;
    otherPlayer.x += olv.x * playerBuff;
    otherPlayer.y += olv.y * playerBuff;

    if (player.subtype !== 'bot' && otherPlayer.subtype === 'bot')
      player.dead = true;
    if (otherPlayer.subtype !== 'bot' && player.subtype === 'bot')
      otherPlayer.dead = true;

    /*
      Whenever we have one state affecting the (x, y) coordinates of
      another state, we should group them together using the util.groupStates() function.
      Otherwise we will may get flicker when the two states interact across
      a cell boundary.
      In this case, if we don't use groupStates(), there will be flickering when you
      try to push another player across to a different cell.
    */
    this.util.groupStates([player, otherPlayer]);
  }
};

module.exports = CellController;
