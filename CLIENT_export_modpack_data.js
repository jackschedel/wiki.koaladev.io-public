// priority: -10000
// Exports item names that depend on NBT/data components (potions, enchanted
// books, tipped arrows, etc.). These can only be enumerated client-side: they
// live in the creative search tab, which is populated after joining a world.
// The server export (SERVER_export_modpack_data.js) only writes base names.
//
// We read CreativeModeTabs.searchTab().getDisplayItems() directly rather than
// Item.getList(): that KubeJS helper is backed by a shared static cache that
// the (empty) server-side call already populated, so it would return stale data.

// Java classes are loaded once at module scope. They must NOT be declared with
// `const`/`let` inside a `try` block: KubeJS's Rhino double-hoists those and
// throws "redeclaration of var", which is what silently disabled the registry
// serialization context (leaving every nbt field null).
const McClient = Java.loadClass('net.minecraft.client.Minecraft')
const JsonOpsCls = Java.loadClass('com.mojang.serialization.JsonOps')
const RegistryOpsCls = Java.loadClass('net.minecraft.resources.RegistryOps')
const ItemStackCls = Java.loadClass('net.minecraft.world.item.ItemStack')
const CreativeModeTabsCls = Java.loadClass('net.minecraft.world.item.CreativeModeTabs')

// The export below writes into the single shared file local/modpack_data.json,
// storing its payload under the key item_nbt. The server export writes the
// other keys (item_names, recipe_data, item_tags, fluid_tags) to the same file.
// Because the server and client scripts run separately, this read-merge-write
// preserves whatever keys the server already wrote (and vice versa).
function mergeModpackData(updates) {
    let existing = {}
    try {
        // JsonIO.read() returns a Java Map whose toString() isn't valid JSON;
        // readJson() gives a JsonElement we can stringify and parse cleanly.
        let current = JsonIO.readJson('local/modpack_data.json')
        if (current && !current.isJsonNull()) {
            existing = JSON.parse(JsonIO.toString(current))
        }
    } catch (e) {
        existing = {}
    }
    Object.keys(updates).forEach(k => existing[k] = updates[k])
    JsonIO.write('local/modpack_data.json', existing)
}

// Pull the distinguishing payload off a stack. The data that makes two stacks
// of the same item id differ (potion contents, banner patterns, enchantments,
// turbine material, computercraft upgrades, ...) lives in the stack's NBT. The
// item's own getTag()/getComponents() accessors aren't reachable through the
// KubeJS Rhino remapper, so instead we serialize the whole stack with
// ItemStack.CODEC using the world's registry access (needed to resolve holder
// references like potion/enchantment ids). We encode through JsonOps and parse
// the data sub-object into a native JS object so it is written as real nested
// JSON rather than an opaque SNBT string. On 1.20.x that sub-object is "tag";
// on 1.20.5+ it's "components" -- we look for either. Returns the object, or
// null when the stack carries no extra data. `ops` is built once by the caller.
function stackData(stack, ops, id) {
    if (!ops) return null

    try {
        let res = ItemStackCls.CODEC.encodeStart(ops, stack)
        let jsonOpt = res.result()
        if (!jsonOpt.isPresent()) {
            let err = res.error()
            console.error('[NBT EXPORT] failed to encode ' + id + ': '
                + (err.isPresent() ? err.get().message() : 'unknown error'))
            return null
        }
        // The encoded value is a JSON object {id, Count, tag/components}; only
        // the data sub-object distinguishes variants of the same item id
        // ("tag" on 1.20.x, "components" on 1.20.5+). Parse it into a real JS
        // object so it serializes as nested JSON, not an SNBT string.
        let root = jsonOpt.get().getAsJsonObject()
        let data = root.has('tag') ? root.get('tag')
            : (root.has('components') ? root.get('components') : null)
        return data ? JSON.parse(data.toString()) : null
    } catch (e) {
        console.error('[NBT EXPORT] failed to encode ' + id + ': ' + e)
        return null
    }
}

// Build the RegistryOps used to serialize stacks. Requires being in a world so
// the client level's registry access is available; returns null otherwise (the
// caller then falls back to legacy NBT).
function nbtSerializationContext() {
    try {
        let level = McClient.getInstance().level
        if (!level) return null
        return RegistryOpsCls.create(JsonOpsCls.INSTANCE, level.registryAccess())
    } catch (e) {
        console.error('[NBT EXPORT] could not build registry serialization context: ' + e)
        return null
    }
}

function exportNbtNames() {
    let displayItems
    try {
        displayItems = CreativeModeTabsCls.searchTab().getDisplayItems()
    } catch (e) {
        console.error('[NBT EXPORT] creative search tab not ready: ' + e)
        return
    }

    if (!displayItems || displayItems.size() === 0) {
        console.warn('[NBT EXPORT] search tab is empty; skipping (open creative once or relog if this persists)')
        return
    }

    let ops = nbtSerializationContext()

    // Group every search-tab stack by item id, collecting its distinct names
    // together with the NBT payload that produces each name, so the variants
    // are actually distinguishable downstream.
    let variants = {}
    let seen = {}
    displayItems.forEach(stack => {
        let id
        try {
            id = Item.getId(stack.getItem()).toString()
        } catch (e) {
            return
        }
        if (!variants[id]) variants[id] = []

        let name
        try {
            name = stack.getHoverName().getString()
        } catch (e) {
            name = id
        }

        // The distinguishing data lives in the stack's NBT.
        let nbt = stackData(stack, ops, id)

        // Dedupe on the (name, nbt) pair: two stacks that share a name but
        // differ in their data are still distinct variants worth recording.
        let sig = id + '\u0000' + name + '\u0000' + JSON.stringify(nbt)
        if (seen[sig]) return
        seen[sig] = true
        variants[id].push({ name: name, nbt: nbt })
    })

    // An item only "needs context for its name" if its variants actually
    // resolve to more than one distinct name. Items whose components don't
    // change the name (e.g. dyed leather armor) are correctly left out.
    let nbtNames = {}
    Object.keys(variants).forEach(id => {
        // Skip ids with a large number of variants (e.g. pipe/cable
        // microblocks, covers and facades): their names are derived from the
        // contained block and just add noise.
        if (variants[id].length > 250) return
        let names = {}
        variants[id].forEach(v => { names[v.name] = true })
        if (Object.keys(names).length > 1) nbtNames[id] = variants[id]
    })

    console.log('[NBT EXPORT] ' + Object.keys(variants).length + ' ids in search tab, '
        + Object.keys(nbtNames).length + ' need NBT context for their name')
    mergeModpackData({ item_nbt: nbtNames })
}

// Runs only on `/kubejs reload client_scripts`, which re-evaluates this file.
// We do NOT hook ClientEvents.loggedIn: the creative search tab is only
// populated after the creative inventory has been opened at least once, so a
// world-join export would see an empty tab. Open creative once, then reload.
if (Client.player) exportNbtNames()
