const test = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const { PVP } = require("../lib/PVP")

function createBot (hasShield = true) {
    const bot = new EventEmitter()
    bot.calls = []
    bot.pathfinder = {
        stop () {
            setImmediate(() => bot.emit("path_stop"))
        },
        setGoal () {}
    }
    bot.supportFeature = () => false
    bot.inventory = {
        slots: {
            "off-hand": hasShield ? { name: "shield" } : null
        }
    }
    bot.getEquipmentDestSlot = () => "off-hand"
    bot.deactivateItem = () => bot.calls.push("deactivateItem")
    return bot
}

function createPvp (bot) {
    const pvp = Object.create(PVP.prototype)
    pvp.bot = bot
    pvp.target = {}
    pvp.blockingExplosion = false
    return pvp
}

test("stop lowers an equipped shield before waiting for path_stop", async () => {
    const bot = createBot()
    const pvp = createPvp(bot)

    const stopping = pvp.stop()

    assert.deepEqual(bot.calls, ["deactivateItem"])
    await stopping
    assert.equal(pvp.target, undefined)
})

test("forceStop lowers an equipped shield", () => {
    const bot = createBot()
    const pvp = createPvp(bot)

    pvp.forceStop()

    assert.deepEqual(bot.calls, ["deactivateItem"])
    assert.equal(pvp.target, undefined)
})

test("stop does not deactivate an item when no shield is equipped", async () => {
    const bot = createBot(false)
    const pvp = createPvp(bot)

    await pvp.stop()

    assert.deepEqual(bot.calls, [])
})
