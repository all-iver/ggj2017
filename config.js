// Global configuration options for IOGrid back end

var PIXEL_SCALE = 5;
var TILE_SIZE = 16 * PIXEL_SCALE;
var LEVEL_SIZE = { width: 50, height: 50 }; // in tiles
var BEACH_SIZE = 15; // in tiles from the bottom
var WORLD_WIDTH = LEVEL_SIZE.width * TILE_SIZE; // in pixels
var WORLD_HEIGHT = LEVEL_SIZE.height * TILE_SIZE; // in pixels

module.exports = {
  PIXEL_SCALE: PIXEL_SCALE,
  TILE_SIZE: TILE_SIZE,
  LEVEL_SIZE: LEVEL_SIZE,
  BEACH_SIZE: BEACH_SIZE,

  // Having a large world (lower player density) is more efficient.
  // You can divide it up into cells to split up the workload between
  // multiple CPU cores.
  WORLD_WIDTH: WORLD_WIDTH,
  WORLD_HEIGHT: WORLD_HEIGHT,
  // Dividing the world into tall vertical strips (instead of square cells)
  // tends to be more efficient (but this may vary depending on your use case
  // and world size).
  WORLD_CELL_WIDTH: WORLD_WIDTH,// / 4, // waves don't work unless all cells know about all of them :(
  WORLD_CELL_HEIGHT: WORLD_HEIGHT,
  /*
    The WORLD_CELL_OVERLAP_DISTANCE allows players/states from two different
    cells on the grid to interact with one another.
    States from different cells will show un in your cell controller but will have a
    special 'external' property set to true.
    This represents the maximum distance that two states can be from one another if they
    are in different cells and need to interact with one another.
    A smaller value is more efficient. Since this overlap area requires coordination
    between multiple cells.
  */
  WORLD_CELL_OVERLAP_DISTANCE: 150,
  /*
    This is the interval (in milliseconds) within which the world updates itself.
    It also determines the frequency at which data is broadcast to users.
    Making this value higher will boost performance and reduce bandwidth consumption
    but will increase lag. 20ms is actually really fast - If you add some sort of
    motion smoothing on the front end, 50ms or higher should be more than adequate.
  */
  WORLD_UPDATE_INTERVAL: 50,
  // Delete states which have gone stale (not being updated anymore).
  WORLD_STALE_TIMEOUT: 1000,
  // Coins don't move, so we will only refresh them
  // once per second.
  SPECIAL_UPDATE_INTERVALS: {
    1000: ['coin']
    // 50: ['wave']
  },

  PLAYER_DEFAULT_MOVE_SPEED: 6,
  PLAYER_DIAMETER: 45,
  PLAYER_MASS: 20,

  // Note that the number of bots needs to be either 0 or a multiple of the number of
  // worker processes or else it will get rounded up/down.
  BOT_COUNT: 12,
  BOT_MOVE_SPEED: 10,
  BOT_MASS: 10,
  BOT_DEFAULT_DIAMETER: 45,
  BOT_CHANGE_DIRECTION_PROBABILITY: 0.01,

  COIN_UPDATE_INTERVAL: 1000,
  COIN_DROP_INTERVAL: 400,
  WAVE_DROP_INTERVAL: 10000,
  COIN_MAX_COUNT: 200,
  COIN_PLAYER_NO_DROP_RADIUS: 80,
  // The probabilities need to add up to 1.
  COIN_TYPES: [
    {
      type: 4,
      value: 1,
      radius: 20,
      probability: 0.25
    },
    {
      type: 3,
      value: 2,
      radius: 20,
      probability: 0.6
    },
    {
      type: 2,
      value: 6,
      radius: 20,
      probability: 0.1
    },
    {
      type: 1,
      value: 12,
      radius: 20,
      probability: 0.05
    }
  ],

  ATTACK_TIMEOUT: 500,

  // We can use this to filter out properties which don't need to be sent
  // to the front end.
  OUTBOUND_STATE_TRANSFORMERS: {
    coin: genericStateTransformer,
    player: genericStateTransformer,
    wave: genericStateTransformer
  }
};

var privateProps = {
  ccid: true,
  tcid: true,
  mass: true,
  speed: true,
  changeDirProb: true,
  repeatOp: true,
  swid: true,
  processed: true,
  pendingGroup: true,
  group: true,
  version: true,
  external: true
};

function genericStateTransformer(state) {
  var clone = {};
  Object.keys(state).forEach(function (key) {
    if (!privateProps[key]) {
      clone[key] = state[key];
    }
  });
  return clone;
}
