const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.20.4')
const ChunkColumn = require('prismarine-chunk')(registry)
const World = require('prismarine-world')(registry)
const { PVP } = require('../lib/PVP')

const botPosition = new Vec3(8.5, 64, 8.5)
const directions = [
  { name: 'east', x: 1, z: 0 },
  { name: 'south', x: 0, z: 1 },
  { name: 'west', x: -1, z: 0 },
  { name: 'north', x: 0, z: -1 },
  { name: 'southeast', x: 1, z: 1 },
  { name: 'southwest', x: -1, z: 1 },
  { name: 'northwest', x: -1, z: -1 },
  { name: 'northeast', x: 1, z: -1 }
]

function createWorld () {
  const chunk = new ChunkColumn()
  const world = new World(null).sync
  world.setColumn(0, 0, chunk)
  return { chunk, world }
}

function setBlock (chunk, position, name) {
  const block = registry.blocksByName[name]
  assert.ok(block, `unknown block ${name}`)
  chunk.setBlockType(position.floored(), block.id)
}

function createPvp (world, targetPosition) {
  const bot = new EventEmitter()
  bot.entity = { position: botPosition.clone(), eyeHeight: 1.62 }
  bot.supportFeature = () => true
  bot.lookAt = async () => {}
  bot.attack = () => {}
  bot.emit = EventEmitter.prototype.emit.bind(bot)

  // Same block lookup as mineflayer's blocks plugin, backed by the real world.
  bot.blockAt = position => world.getBlock(position)

  // Copied from mineflayer 4.39.0 lib/plugins/blocks.js canSeeBlock.
  bot.canSeeBlock = block => {
    const headPos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0)
    const range = headPos.distanceTo(block.position)
    const dir = block.position.offset(0.5, 0.5, 0.5).minus(headPos)
    const match = (inputBlock, iter) => {
      const intersect = iter.intersect(inputBlock.shapes, inputBlock.position)
      if (intersect) return true
      return block.position.equals(inputBlock.position)
    }
    const blockAtCursor = world.raycast(headPos, dir.normalize(), range, match)
    return blockAtCursor && blockAtCursor.position.equals(block.position)
  }

  const target = {
    name: 'player',
    position: targetPosition.clone(),
    height: 1.8,
    metadata: []
  }
  const pvp = Object.create(PVP.prototype)
  pvp.bot = bot
  pvp.target = target
  pvp.wasInRange = true
  pvp.timeToNextAttack = 0
  pvp.blockingExplosion = false
  pvp.attackRange = 10
  pvp.viewDistance = 128
  pvp.meleeAttackRate = { getTicks: () => 5 }
  return { pvp, bot }
}

function wall (chunk, direction, heights) {
  const target = botPosition.offset(direction.x * 3, 0, direction.z * 3).floored()
  const beforeTarget = target.offset(-direction.x, 0, -direction.z)
  for (let step = -2; step <= 2; step++) {
    const position = beforeTarget.offset(-direction.z * step, 0, direction.x * step)
    for (const height of heights) setBlock(chunk, position.offset(0, height, 0), 'stone')
  }
}

function encase (chunk, position) {
  const feet = position.floored()
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 2; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && z === 0 && (y === 0 || y === 1)) continue
        setBlock(chunk, feet.offset(x, y, z), 'stone')
      }
    }
  }
}

const cases = []
function addCase (name, expected, offset, setup = () => {}, unloaded = false) {
  cases.push({ name, expected, offset, setup, unloaded })
}

for (const distance of [1, 2, 3]) {
  for (const direction of directions) {
    addCase(`open air, ${distance} blocks ${direction.name}`, true,
      new Vec3(direction.x * distance, 0, direction.z * distance))
  }
}

for (const vertical of [{ name: 'one block higher', y: 1 }, { name: 'one block lower', y: -1 }]) {
  for (const direction of directions) {
    addCase(`${vertical.name}, ${direction.name}`, true,
      new Vec3(direction.x * 2, vertical.y, direction.z * 2))
  }
}

for (const direction of directions) {
  const offset = new Vec3(direction.x * 2, 0, direction.z * 2)
  addCase(`standing in tall grass, ${direction.name}`, true, offset, (chunk, position) => {
    setBlock(chunk, position.floored(), 'tall_grass')
  })
  addCase(`in water, ${direction.name}`, true, offset, (chunk, position) => {
    setBlock(chunk, position.floored(), 'water')
  })
  addCase(`on a stone slab, ${direction.name}`, true, offset, (chunk, position) => {
    setBlock(chunk, position.offset(0, -1, 0), 'stone_slab')
  })
  addCase(`full wall at chest and head, ${direction.name}`, false, new Vec3(direction.x * 3, 0, direction.z * 3), (chunk) => {
    wall(chunk, direction, [0, 1])
  })
  addCase(`feet blocked but chest visible, ${direction.name}`, true, new Vec3(direction.x * 3, 0, direction.z * 3), (chunk) => {
    wall(chunk, direction, [-1])
  })
  addCase(`chest blocked, ${direction.name}`, false, new Vec3(direction.x * 3, 0, direction.z * 3), (chunk) => {
    wall(chunk, direction, [0])
  })
  addCase(`fully encased, ${direction.name}`, false, new Vec3(direction.x * 3, 0, direction.z * 3), (chunk, position) => {
    encase(chunk, position)
  })
}

addCase('target chunk unloaded', false, new Vec3(3, 0, 0), () => {}, true)

for (const scenario of cases) {
  test(scenario.name, async () => {
    const { chunk, world } = createWorld()
    const targetPosition = botPosition.plus(scenario.offset)
    scenario.setup(chunk, targetPosition)
    if (scenario.unloaded) world.unloadColumn(0, 0)

    const { pvp, bot } = createPvp(world, targetPosition)
    let attacks = 0
    bot.attack = () => { attacks++ }

    pvp.update()
    await new Promise(resolve => setImmediate(resolve))

    console.log(`${scenario.expected ? 'ATTACK ' : 'BLOCK '} ${scenario.name}: attacked=${attacks}`)
    assert.equal(attacks, scenario.expected ? 1 : 0)
  })
}
