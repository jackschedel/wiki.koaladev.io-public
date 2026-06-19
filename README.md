<h1 align="center"><b>wiki.koaladev.io Sources</b></h1>

<p align="center">
    <a href="https://wiki.koaladev.io" target="_blank"><img src="https://wiki.koaladev.io/favicon.png" alt="wiki.koaladev.io icon" width="100" /></a>
</p>

<h4 align="center"><b>This is the public sources repository for https://wiki.koaladev.io.</b></h4>

<p align="center">
<a href="https://github.com/jackschedel/wiki.koaladev.io-public/issues" target="_blank">
    <img src="https://img.shields.io/github/issues/jackschedel/wiki.koaladev.io-public?style=flat-square" alt="issues"/>
</a>

<a href="https://github.com/jackschedel/wiki.koaladev.io-public/pulls" target="_blank">
    <img src="https://img.shields.io/github/issues-pr/jackschedel/wiki.koaladev.io-public?style=flat-square" alt="pull-requests"/>
</a>

</p>

## Repository Contents

Currently, this repository is composed of three things:

- **`quest-sources.config.mjs`** - Defines where to find the FTB Quests files for each modpack in the wiki.
- **`item_icons/`** - Contains the preview PNGs for every block and item in every modpack on the wiki.
- **`recipe_data/`** - Contains the recipe data for all recipes in the pack, (currently not used)

> [!NOTE]
> Any item icons with `/` in the Minecraft item ID will appear in a subfolder. Because this folder is not per-modpack, it is possible that there will be conflicts between items/blocks of the same name (either for different versions of the mod or for something generic like `kubejs:coin`). If this becomes an issue, I can add support for per-modpack image overrides as well.

The `item_icons` folder includes the item icon for **every** item in the pack, not just the ones needed to render the quest book. My hope is that these can be useful in the future, either for future wiki features, or just as a repository for other developers.

## Issues

Please create issues on this repo for any bugs/feature requests for [wiki.koaladev.io](https://wiki.koaladev.io) as a whole, even though this repository is just for the sources.

## Adding a New Modpack

### 1. Configure Quest Sources

Add a new array element in `quest-sources.config.mjs`, following the format:

```js
export default [
  {
    slug: "Monifactory",
    repo: "ThePansmith/Monifactory",
    branch: "main",
    questsPaths: [
      "config/ftbquests/quests",
      "config-overrides/normal/ftbquests/quests",
    ],
    langDirs: ["kubejs/assets/ftbquests/lang"],
  },
  {
    slug: "GregTech-Modern-Community-Pack",
    repo: "GregTechCEu/GregTech-Modern-Community-Pack",
    branch: "main",
    questsPaths: ["config/ftbquests/quests"],
    langDirs: ["kubejs/assets/gtceu/lang"],
  },
];
```

### 2. Export Item Icons

Run the modpack locally on your computer, using a mod to export all block and item previews. I recommend [BlockExporter](https://github.com/KazuOfficial/blockexporter) — I personally made the 1.20.1 Forge release version specifically for this wiki project. This will automatically use the correct filename standard. 

Requirements:
- **Format:** PNG
- **Resolution:** 256×256
- **Filename:** Same as item id in game, replacing `:` with `_`.

Add the exported icons to the `item_icons/` folder.

### 3. Export Recipe Data
Export all recipe data as JSON. If using KubeJS, the following script can be added to the end of any file in `.minecraft/kubejs/server_scripts`:
```js
// priority: -10000
ServerEvents.recipes(event => {
    let recipes = []
    event.forEachRecipe({}, r => {
        recipes.push(JSON.parse(r.json.toString()))
    })

    JsonIO.write('local/exported_recipes.json', { recipes: recipes })
})
```

This will create the file `.minecraft/local/exported_recipes.json`. 

Add the exported recipes to the `recipe_data` folder, renaming `exported_recipes.json` to `{modpack name}.json`

### 4. Create a Pull Request

Submit a Pull Request with your changes.

## Disclaimer

I do not own the rights to any modpack quest content. I do not own the rights to any block or item image previews from Minecraft or from any mods.
