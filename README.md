# Grocery List — a Home Screens plugin

A Todoist project as a touch grocery list on the wall:

- tap the circle to check an item off, × to delete it
- **Add** opens an on-screen keyboard (with é è à ç) and suggestions
- **Add again** chips: recently bought items and your staples, one tap to re-add

## Install

Home Screens editor → **Plugins** → **Install from URL…**:

```
https://github.com/tweetyboopdev2022-code/home-screens-grocery-list/releases/download/v1.0.0/grocery-list-1.0.0.tgz
```

Then paste your Todoist API token (Todoist → Settings → Integrations → Developer) into the plugin's `todoist_token` secret.

## Build

```
npm install && npm test && npm run build
```
