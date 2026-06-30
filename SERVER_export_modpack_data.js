// priority: -10000

// Every export below writes into a single shared file, local/modpack_data.json,
// storing its payload under a named key (item_names, recipe_data, item_tags,
// fluid_tags). The client export adds its own key (item_nbt) to the same file.
// Because the server and client scripts run separately, each write reads the
// existing file first and merges, so neither side clobbers the other's keys.
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

// Java classes are loaded once at module scope. They must NOT be declared with
// `const`/`let` inside a `try`/event block: KubeJS's Rhino double-hoists those
// and throws "redeclaration of var".
const $BuiltInRegistries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
const $ArrayList = Java.loadClass('java.util.ArrayList')

// Base name for every registered item id. We enumerate ids straight from the
// ITEM registry (the same source the tag export uses, which is why tags work)
// rather than the KubeJS Item.getTypeList() helper, which isn't available in
// every KubeJS build and throws here -- previously aborting the whole export.
// NBT-dependent names (potions, enchanted books, etc.) can't be seen here
// because the creative search tab isn't populated server-side; those are
// exported by client_scripts/CLIENT_export_modpack_data.js instead.
function buildItemNames() {
    let names = {}
    let registry = $BuiltInRegistries.ITEM
    // Copy the key set into a public ArrayList; Rhino can't iterate the
    // registry's internal Set view directly (same reason collectTags does it).
    let ids = new $ArrayList(registry.keySet())
    for (let i = 0; i < ids.size(); i++) {
        let id = ids.get(i)
        let key = id.toString()
        try {
            names[key] = Item.of(id).getHoverName().getString()
        } catch (e) {
            names[key] = key
        }
    }
    return { item_names: names }
}

function collectTags(registry) {
    let tagToEntries = {}
    let entryToTags = {}

    // Copy the tag stream into a public ArrayList; Rhino can't reflect on
    // the package-private internal Stream classes directly.
    let tagKeys = new $ArrayList(registry.getTagNames().toList())
    for (let i = 0; i < tagKeys.size(); i++) {
        let tagKey = tagKeys.get(i)
        let tagId = tagKey.location().toString()
        let entries = []

        let optional = registry.getTag(tagKey)
        if (optional.isPresent()) {
            let holderSet = optional.get()
            let count = holderSet.size()
            for (let j = 0; j < count; j++) {
                let id = registry.getKey(holderSet.get(j).value()).toString()
                entries.push(id)
                if (!entryToTags[id]) entryToTags[id] = []
                entryToTags[id].push(tagId)
            }
        }

        tagToEntries[tagId] = entries
    }

    return { tagToEntries: tagToEntries, entryToTags: entryToTags }
}

function buildTags() {
    let items = collectTags($BuiltInRegistries.ITEM)
    let fluids = collectTags($BuiltInRegistries.FLUID)

    return {
        item_tags: {
            tag_to_items: items.tagToEntries,
            item_to_tags: items.entryToTags
        },
        fluid_tags: {
            tag_to_fluids: fluids.tagToEntries,
            fluid_to_tags: fluids.entryToTags
        }
    }
}

// Full export. Recipe JSON is only reachable through the recipes event, so this
// runs the recipe export alongside the name/tag exports. Fires on world load
// and on `/reload` (a datapack reload).
//
// Each section is built into a single payload and written with ONE
// mergeModpackData call. JsonIO.write is buffered, so writing per-key would make
// each merge re-read the same stale (pre-tick) file and the last write would
// clobber the earlier ones. Each section is also wrapped in its own try/catch so
// a failure in one (e.g. a malformed recipe) can't drop the others.
ServerEvents.recipes(event => {
    let payload = {}

    try {
        Object.assign(payload, buildItemNames())
    } catch (e) {
        console.error('[MODPACK EXPORT] item names failed: ' + e)
    }

    try {
        let recipes = []
        event.forEachRecipe({}, r => {
            try {
                recipes.push(JSON.parse(r.json.toString()))
            } catch (re) {
                // Skip a single unserializable recipe rather than aborting the loop.
            }
        })
        payload.recipe_data = { recipes: recipes }
    } catch (e) {
        console.error('[MODPACK EXPORT] recipe export failed: ' + e)
    }

    try {
        Object.assign(payload, buildTags())
    } catch (e) {
        console.error('[MODPACK EXPORT] tag export failed: ' + e)
    }

    mergeModpackData(payload)
})

// KubeJS has no `Utils.staticServer` binding; the running MinecraftServer is
// reached through the mod loader's ServerLifecycleHooks instead. The class lives
// under a different package on Forge vs NeoForge, so try both and treat a
// missing class (wrong loader) as "no server".
function getRunningServer() {
    let classNames = [
        'net.minecraftforge.server.ServerLifecycleHooks',
        'net.neoforged.neoforge.server.ServerLifecycleHooks'
    ]
    for (let i = 0; i < classNames.length; i++) {
        try {
            return Java.loadClass(classNames[i]).getCurrentServer()
        } catch (e) {
            // Class not present on this loader; try the next candidate.
        }
    }
    return null
}

// `/kubejs reload server_scripts` re-evaluates this file but does NOT fire
// ServerEvents.recipes (it reloads scripts only, not datapacks/recipes). If a
// server is already running, regenerate the registry-based exports now so a
// script reload alone refreshes item_names/item_tags/fluid_tags without
// rejoining. Recipe data still needs a datapack reload (`/reload`) to refresh,
// since recipe JSON is only exposed through the recipes event.
if (getRunningServer()) {
    let payload = {}
    try {
        Object.assign(payload, buildItemNames())
    } catch (e) {
        console.error('[MODPACK EXPORT] item names failed: ' + e)
    }
    try {
        Object.assign(payload, buildTags())
    } catch (e) {
        console.error('[MODPACK EXPORT] tag export failed: ' + e)
    }
    mergeModpackData(payload)
}